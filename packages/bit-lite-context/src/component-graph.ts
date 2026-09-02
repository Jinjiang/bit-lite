import type { Workspace, WorkspaceComponent } from "./types/index.js";
import { BitLiteError } from "./utils/errors.js";

/**
 * What: the single definition of what one component must be processed after.
 *
 * Why: a component depends on the workspace components providing its
 * `workspace:*` dependencies *and* on the workspace component providing its
 * env, because an env is itself a component that must be built and versioned
 * before anything selecting it. Compilation and recording previously answered
 * this question separately, which is exactly the kind of disagreement that
 * only shows up as a mis-ordered build or a missing version.
 */
export function getComponentPrerequisitePackageNames(
  component: WorkspaceComponent
): readonly string[] {
  return component.internalEnvPackageName === undefined
    ? component.internalDependencyPackageNames
    : [...component.internalDependencyPackageNames, component.internalEnvPackageName];
}

/**
 * Orders components so every component follows the prerequisites it shares the
 * selection with. Prerequisites outside `components` are left to the caller:
 * compilation pulls them in, recording refuses them, and neither policy
 * belongs in the graph.
 */
export function orderComponentsByPrerequisites(
  workspace: Workspace,
  components: readonly WorkspaceComponent[] = workspace.components
): WorkspaceComponent[] {
  const { byPackageName, included, sorted } = indexSelection(workspace, components);
  const ordered: WorkspaceComponent[] = [];
  const permanent = new Set<string>();
  const active = new Set<string>();

  const visit = (component: WorkspaceComponent, trail: readonly string[]): void => {
    if (permanent.has(component.packageName)) return;
    if (active.has(component.packageName)) {
      // The trail already starts at the repeated package, so the reported path
      // is the cycle itself rather than the route that happened to reach it.
      const start = trail.indexOf(component.packageName);
      const cycle = [...trail.slice(start === -1 ? 0 : start), component.packageName];
      throw new BitLiteError(
        `component package or environment dependency cycle detected: ${cycle.join(" -> ")}`
      );
    }

    active.add(component.packageName);
    for (const prerequisiteName of getComponentPrerequisitePackageNames(component)) {
      if (!included.has(prerequisiteName)) continue;
      const prerequisite = byPackageName.get(prerequisiteName);
      if (!prerequisite) {
        throw new BitLiteError(`missing internal dependency "${prerequisiteName}"`);
      }
      visit(prerequisite, [...trail, component.packageName]);
    }
    active.delete(component.packageName);

    permanent.add(component.packageName);
    ordered.push(component);
  };

  for (const component of sorted) visit(component, []);
  return ordered;
}

/**
 * Groups components into layers where every member of a layer has all of its
 * in-selection prerequisites in earlier layers, so one layer can be processed
 * concurrently. Cycles are rejected by the ordering pass first, so layering
 * itself can never stall and both entry points report the same diagnostic.
 */
export function layerComponentsByPrerequisites(
  workspace: Workspace,
  components: readonly WorkspaceComponent[] = workspace.components
): WorkspaceComponent[][] {
  const ordered = orderComponentsByPrerequisites(workspace, components);
  const { byPackageName, included } = indexSelection(workspace, components);

  // Ordered traversal guarantees every prerequisite already has a level, so a
  // component's level is one past the deepest prerequisite it waits on.
  const levels = new Map<string, number>();
  for (const component of ordered) {
    let level = 0;
    for (const prerequisiteName of getComponentPrerequisitePackageNames(component)) {
      if (!included.has(prerequisiteName)) continue;
      if (!byPackageName.has(prerequisiteName)) continue;
      level = Math.max(level, (levels.get(prerequisiteName) ?? 0) + 1);
    }
    levels.set(component.packageName, level);
  }

  const layers: WorkspaceComponent[][] = [];
  for (const component of ordered) {
    const level = levels.get(component.packageName) ?? 0;
    (layers[level] ??= []).push(component);
  }
  for (const layer of layers) layer.sort((left, right) => left.id.localeCompare(right.id));
  return layers;
}

function indexSelection(workspace: Workspace, components: readonly WorkspaceComponent[]) {
  return {
    byPackageName: new Map(
      workspace.components.map((component) => [component.packageName, component])
    ),
    included: new Set(components.map((component) => component.packageName)),
    // Sorting the roots keeps the result independent of the order a caller
    // happened to select components in.
    sorted: [...components].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

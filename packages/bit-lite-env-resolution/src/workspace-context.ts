import { BitLiteError } from "bit-lite-utils";
import type { Workspace, WorkspaceComponent } from "bit-lite-context";
import { getSelectedEnvKey } from "./env-identity.js";
import { loadWorkspaceEnvContexts } from "./env-loader.js";
import type { EnvContext, WorkspaceContext, WorkspaceEnvGroup } from "./types.js";

/**
 * What: the resolved phase of workspace preparation.
 *
 * Why it is a separate package: reading the base workspace needs nothing
 * installed, while resolving an env requires installation, linking, and env
 * materialization to have happened first. A package boundary is what enforces
 * that separation — a command that must stay independent of installed packages
 * cannot reach this code, because it does not depend on this package.
 */

/** Resolve installed env packages while retaining references to canonical workspace components. */
export async function resolveWorkspace(workspace: Workspace): Promise<WorkspaceContext> {
  const envByComponent = await loadWorkspaceEnvContexts(workspace);
  return {
    workspace,
    components: workspace.components.map((component) => {
      const env = envByComponent.get(component.id);
      if (!env) throw new BitLiteError(`env for component "${component.id}" was not loaded`);
      return { component, env };
    }),
  };
}

/**
 * Groups the selection by selected env, in a stable order. Commands that run
 * one vendor per env — test and preview — plan from these groups, so the order
 * decides the order their tasks appear in.
 */
export function groupWorkspaceComponentsByEnv(
  context: WorkspaceContext,
  selectedComponents: readonly WorkspaceComponent[]
): WorkspaceEnvGroup[] {
  const selectedIds = readSelectedIds(context, selectedComponents);

  const groups = new Map<string, { env: EnvContext; components: WorkspaceComponent[] }>();
  for (const { component, env } of context.components) {
    if (!selectedIds.has(component.id)) continue;
    const key = getSelectedEnvKey(env.identity);
    const group = groups.get(key);
    if (group) group.components.push(component);
    else groups.set(key, { env, components: [component] });
  }
  return sortByEnvKey([...groups.values()], (group) => group.env);
}

/** Every distinct env in the workspace, in the same order groups appear in. */
export function getWorkspaceEnvs(context: WorkspaceContext): EnvContext[] {
  const envs = new Map<string, EnvContext>();
  for (const { env } of context.components) envs.set(getSelectedEnvKey(env.identity), env);
  return sortByEnvKey([...envs.values()], (env) => env);
}

/**
 * A selection must name the workspace's own component objects: the resolved
 * context is keyed by identity, so a copy would silently resolve to no env.
 */
function readSelectedIds(
  context: WorkspaceContext,
  selectedComponents: readonly WorkspaceComponent[]
): ReadonlySet<string> {
  const canonicalById = new Map(
    context.workspace.components.map((component) => [component.id, component])
  );
  const selectedIds = new Set<string>();
  for (const component of selectedComponents) {
    if (canonicalById.get(component.id) !== component) {
      throw new BitLiteError(
        `selected component "${component.id}" is not the canonical workspace component`
      );
    }
    if (selectedIds.has(component.id)) {
      throw new BitLiteError("selected components must not contain duplicate ids");
    }
    selectedIds.add(component.id);
  }
  return selectedIds;
}

function sortByEnvKey<Item>(items: Item[], toEnv: (item: Item) => EnvContext): Item[] {
  return items.sort((left, right) =>
    getSelectedEnvKey(toEnv(left).identity).localeCompare(getSelectedEnvKey(toEnv(right).identity))
  );
}

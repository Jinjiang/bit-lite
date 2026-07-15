import path from "node:path";
import { loadComponentPackageRegistry } from "./component-registry.js";
import { loadWorkspaceEnvs } from "./env-loader.js";
import type {
  ComponentPackageRegistry,
  ComponentRef,
  ComponentRuntime,
  SelectedEnvGroup,
  WorkspaceRuntime,
} from "./types/index.js";
import { BitLiteError } from "./utils/errors.js";
import { matchPattern } from "./utils/patterns.js";

export async function loadWorkspace(
  workspaceRoot: string,
  options: { registry?: ComponentPackageRegistry } = {}
): Promise<WorkspaceRuntime> {
  const registry = options.registry ?? await loadComponentPackageRegistry(path.resolve(workspaceRoot));
  const loadedByComponent = await loadWorkspaceEnvs(registry);
  const envs: WorkspaceRuntime["envs"] = {};
  const components = registry.components.map<ComponentRuntime>((component) => {
    const env = loadedByComponent.get(component.id);
    if (!env) throw new BitLiteError(`env for component "${component.id}" was not loaded`);
    envs[env.packageName] = env;
    return {
      id: component.id,
      rootDir: component.rootDir,
      packageName: component.packageName,
      kind: component.kind,
      envRef: component.env,
      env,
    };
  });

  const groups = Object.values(
    components.reduce<Record<string, WorkspaceRuntime["groups"][number]>>((acc, component) => {
      const group = acc[component.env.packageName] ?? (acc[component.env.packageName] = {
        envName: component.env.packageName,
        env: component.env,
        components: [],
      });
      group.components.push({ id: component.id, rootDir: component.rootDir, packageName: component.packageName });
      return acc;
    }, {})
  ).sort((left, right) => left.envName.localeCompare(right.envName));

  return {
    workspaceRoot: registry.workspaceRoot,
    config: registry.config,
    envs,
    components,
    groups,
  };
}

export function groupSelectedComponentsByEnv(
  workspace: WorkspaceRuntime,
  selectedComponents: ComponentRef[]
): SelectedEnvGroup[] {
  const selectedIds = new Set(selectedComponents.map((component) => component.id));
  const selectedById = new Map(selectedComponents.map((component) => [component.id, component]));
  if (selectedIds.size !== selectedComponents.length) {
    throw new BitLiteError("selected components must not contain duplicate ids");
  }
  for (const component of selectedComponents) {
    if (!workspace.components.some((candidate) => candidate.id === component.id)) {
      throw new BitLiteError(`selected component "${component.id}" does not exist in workspace`);
    }
  }

  return workspace.groups.flatMap((group) => {
    const components = group.components
      .filter((component) => selectedIds.has(component.id))
      .map((component) => selectedById.get(component.id) ?? component);
    return components.length === 0 ? [] : [{ envName: group.envName, env: group.env, components }];
  });
}

export function selectComponentRefs(components: ComponentRef[], filters: string[]): ComponentRef[] {
  const selected = filters.length === 0
    ? components
    : components.filter((component) => filters.some((filter) => matchPattern(component.id, filter)));
  if (filters.length > 0 && selected.length === 0) {
    throw new BitLiteError(`--filter did not match any components: ${filters.join(", ")}`);
  }
  return selected.map(({ id, rootDir, packageName }) => ({ id, rootDir, packageName }));
}

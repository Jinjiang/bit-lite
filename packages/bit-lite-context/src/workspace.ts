import path from "node:path";
import { loadConfig, resolveEnvs } from "./config.js";
import { BitLiteError } from "./utils/errors.js";
import { componentIdFromDir, discoverComponentDirs, matchPattern } from "./utils/patterns.js";
import type { ComponentRef, ComponentRuntime, SelectedEnvGroup, WorkspaceRuntime } from "./types/index.js";
import { toPosixPath } from "./utils/path-utils.js";

export async function loadWorkspace(workspaceRoot: string): Promise<WorkspaceRuntime> {
  const absoluteRoot = path.resolve(workspaceRoot);
  const workspaceConfig = await loadConfig(absoluteRoot);
  const envs = resolveEnvs(workspaceConfig);
  const patternEntries = Object.entries(workspaceConfig.components ?? {});
  const componentDirs = await discoverComponentDirs(
    absoluteRoot,
    patternEntries.map(([pattern]) => pattern)
  );

  const envNames = Object.keys(envs);
  const components: ComponentRuntime[] = componentDirs.map((rootDir) => {
    const relativeDir = toPosixPath(path.relative(absoluteRoot, rootDir));
    const envName = resolveComponentEnv(relativeDir, patternEntries, envNames);
    if (!envs[envName]) throw new BitLiteError(`component "${relativeDir}" resolved to unknown env "${envName}"`);
    return {
      id: componentIdFromDir(absoluteRoot, rootDir),
      rootDir,
      envName,
    };
  });

  const groups = Object.values(
    components.reduce<Record<string, WorkspaceRuntime["groups"][number]>>((acc, component) => {
      const env = envs[component.envName];
      if (!env) throw new BitLiteError(`env "${component.envName}" is not resolved`);
      const group =
        acc[component.envName] ??
        (acc[component.envName] = {
          envName: component.envName,
          env,
          components: [],
        });
      group.components.push({
        id: component.id,
        rootDir: component.rootDir,
      });
      return acc;
    }, {})
  ).sort((left, right) => left.envName.localeCompare(right.envName));

  return {
    workspaceRoot: absoluteRoot,
    config: {
      envs,
      components: workspaceConfig.components ?? {},
    },
    envs,
    components: components.sort((left, right) => left.id.localeCompare(right.id)),
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

  const groups: SelectedEnvGroup[] = [];
  for (const group of workspace.groups) {
    const components = group.components
      .filter((component) => selectedIds.has(component.id))
      .map((component) => {
        const selected = selectedById.get(component.id);
        return selected ?? component;
      });

    if (components.length === 0) continue;
    groups.push({
      envName: group.envName,
      env: group.env,
      components,
    });
  }

  return groups;
}

export function selectComponentRefs(components: ComponentRuntime[], filters: string[]): ComponentRef[] {
  const selected =
    filters.length === 0
      ? components
      : components.filter((component) => filters.some((filter) => matchPattern(component.id, filter)));

  if (filters.length > 0 && selected.length === 0) {
    throw new BitLiteError(`--filter did not match any components: ${filters.join(", ")}`);
  }

  return selected.map(({ id, rootDir }) => ({ id, rootDir }));
}

function resolveComponentEnv(patternPath: string, patternEntries: Array<[string, string]>, envNames: string[]) {
  let envName: string | undefined;
  for (const [pattern, candidateEnv] of patternEntries) {
    if (matchPattern(patternPath, pattern)) {
      envName = candidateEnv;
    }
  }
  if (envName) return envName;
  if (patternEntries.length === 0 && envNames.length === 1) {
    const onlyEnv = envNames[0];
    if (onlyEnv) return onlyEnv;
  }
  throw new BitLiteError(`component "${patternPath}" does not match any env pattern`);
}

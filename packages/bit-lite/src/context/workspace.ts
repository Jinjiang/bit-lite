import path from "node:path";
import { loadConfig, resolveEnvs } from "./config.js";
import { BitLiteError } from "../utils/errors.js";
import { componentIdFromDir, discoverComponentDirs, matchPattern } from "../utils/patterns.js";
import type { ComponentRuntime, WorkspaceRuntime } from "../types/index.js";
import { toPosixPath } from "../utils/path-utils.js";

export async function loadWorkspace(workspaceRoot: string): Promise<WorkspaceRuntime> {
  const absoluteRoot = path.resolve(workspaceRoot);
  const config = await loadConfig(absoluteRoot);
  const envs = resolveEnvs(config);
  const patternEntries = Object.entries(config.components ?? {});
  const componentDirs = await discoverComponentDirs(
    absoluteRoot,
    patternEntries.map(([pattern]) => pattern)
  );

  const components: ComponentRuntime[] = componentDirs.map((rootDir) => {
    const relativeDir = toPosixPath(path.relative(absoluteRoot, rootDir));
    const envName = resolveComponentEnv(relativeDir, patternEntries, config.defaultEnv);
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
    config,
    envs,
    components: components.sort((left, right) => left.id.localeCompare(right.id)),
    groups,
  };
}

function resolveComponentEnv(patternPath: string, patternEntries: Array<[string, string]>, defaultEnv: string) {
  let envName = defaultEnv;
  for (const [pattern, candidateEnv] of patternEntries) {
    if (matchPattern(patternPath, pattern)) {
      envName = candidateEnv;
    }
  }
  return envName;
}

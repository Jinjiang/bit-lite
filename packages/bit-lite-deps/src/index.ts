import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isRecord } from "bit-lite-utils";
import { isNodeErrorCode } from "bit-lite-utils/node";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import { installWithPnpmEngine, type InstallOptions } from "./pnpm-engine.js";
import {
  createDependencyLogListener,
  type DependencyInstallProgressEvent,
} from "./progress.js";

export { getPnpmEngineVersion } from "./pnpm-engine.js";

export type {
  DependencyInstallProgressCounts,
  DependencyInstallProgressEvent,
} from "./progress.js";

export type DependencyProjectManifest = {
  name?: string;
  version?: string;
  [key: string]: unknown;
};

export type DependencyProject = {
  rootDir: string;
  manifest: DependencyProjectManifest;
};

export type InstallDependencyProjectsOptions = {
  rootDir: string;
  projects: DependencyProject[];
  /**
   * Optional local packages used by the current demo/development setup.
   * A Bit workspace is not required to live inside a pnpm workspace, and the
   * long-term package source for Bit components is a dedicated npm registry.
   */
  workspacePackages?: DependencyProject[];
  onProgress?: (event: DependencyInstallProgressEvent) => void;
};

export async function installDependencyProjects(options: InstallDependencyProjectsOptions) {
  await writeWorkspaceAnchor(options.rootDir);
  const overrides = createLocalPackageOverrides(
    options.rootDir,
    options.projects,
    options.workspacePackages ?? []
  );
  const installOptions: InstallOptions = {
    dir: options.rootDir,
    // Only bit-lite's own projects are installed. Local packages from an
    // enclosing repository are linked through `overrides` instead: listing them
    // here would materialize `node_modules` inside that repository.
    projects: options.projects.map((project) => ({
      rootDir: project.rootDir,
      manifest: project.manifest,
    })),
    autoInstallPeers: false,
    dedupeDirectDeps: true,
    dedupePeerDependents: true,
    depth: 0,
    enableModulesDir: true,
    // `hoist: false` in config terms.
    hoistPattern: [],
    ignoreScripts: true,
    includeOptionalDeps: true,
    injectWorkspacePackages: false,
    linkWorkspacePackages: Object.keys(overrides).length > 0,
    nodeLinker: "isolated",
    // The lockfile is derived from manifests bit-lite generates, so a stale one
    // must re-resolve instead of failing the install.
    frozenLockfile: false,
    preferFrozenLockfile: true,
    resolvePeersFromWorkspaceRoot: false,
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
  };

  const onLog = options.onProgress
    ? createDependencyLogListener(options.rootDir, options.onProgress)
    : undefined;
  await installWithPnpmEngine(installOptions, onLog);
}

/**
 * Marks the install root as a workspace root.
 *
 * `InstallOptions.dir` is not authoritative: without this file the engine walks
 * up, adopts an enclosing pnpm workspace as the lockfile root, and prunes that
 * repository's `node_modules`. The projects themselves are passed through the
 * API, so the file only has to exist.
 */
async function writeWorkspaceAnchor(rootDir: string) {
  await writeFile(path.join(rootDir, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
}

/**
 * Maps local packages discovered in an enclosing repository to `link:` overrides.
 *
 * The engine has no equivalent of the old `allProjects` / `mutations` split: a
 * project is always an install target. Overriding by name links the package
 * without installing it, which keeps the enclosing repository untouched.
 *
 * Only names some project actually depends on are overridden, so an unrelated
 * package in that repository never enters the graph. Note this links by name
 * regardless of the declared range, where the previous setup linked only when
 * the range matched the local version.
 */
function createLocalPackageOverrides(
  rootDir: string,
  projects: DependencyProject[],
  workspacePackages: DependencyProject[]
) {
  const requested = new Set<string>();
  for (const project of projects) {
    for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
      const dependencies = project.manifest[field];
      if (isRecord(dependencies)) for (const name of Object.keys(dependencies)) requested.add(name);
    }
  }

  const overrides: Record<string, string> = {};
  for (const local of workspacePackages) {
    const name = local.manifest.name;
    if (typeof name !== "string" || !requested.has(name)) continue;
    // Relative, so the generated lockfile stays portable across machines.
    const relative = path.relative(path.resolve(rootDir), path.resolve(local.rootDir));
    overrides[name] = `link:${relative.split(path.sep).join("/")}`;
  }
  return overrides;
}

/**
 * Discovers a containing pnpm workspace only as a temporary demo/development fallback.
 * This is not part of the Bit workspace model: standalone Bit workspaces are valid,
 * so not finding `pnpm-workspace.yaml` is expected and produces an empty package set.
 * Long term, Bit component packages should be installed from a dedicated npm registry
 * instead of being sourced from an enclosing pnpm workspace.
 */
export async function discoverPnpmWorkspacePackages(startDir: string): Promise<DependencyProject[]> {
  const workspaceRoot = await findWorkspaceRoot(path.resolve(startDir));
  if (!workspaceRoot) return [];
  const workspaceFile = path.join(workspaceRoot, "pnpm-workspace.yaml");
  const parsed = parseYaml(await readFile(workspaceFile, "utf8")) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.packages)) return [];
  const patterns = parsed.packages.filter((value): value is string => typeof value === "string");
  const directories = await fg(patterns, {
    cwd: workspaceRoot,
    absolute: true,
    onlyDirectories: true,
    unique: true,
    ignore: ["**/node_modules/**", "**/.bit-lite/**"],
  });
  const projects: DependencyProject[] = [];
  for (const rootDir of [workspaceRoot, ...directories.sort()]) {
    try {
      const manifest = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8")) as unknown;
      if (!isRecord(manifest) || typeof manifest.name !== "string" || typeof manifest.version !== "string") continue;
      projects.push({ rootDir, manifest });
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT")) throw error;
    }
  }
  return projects;
}

async function findWorkspaceRoot(startDir: string) {
  let current = startDir;
  while (true) {
    try {
      await readFile(path.join(current, "pnpm-workspace.yaml"), "utf8");
      return current;
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT")) throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

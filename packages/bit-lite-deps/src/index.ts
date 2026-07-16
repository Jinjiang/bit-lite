import { readFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@pnpm/config";
import { mutateModules, type InstallOptions, type MutatedProject, type ProjectOptions } from "@pnpm/core";
import { createOrConnectStoreController } from "@pnpm/store-connection-manager";
import type { ProjectManifest, ProjectRootDir } from "@pnpm/types";
import { finishWorkers, restartWorkerPool } from "@pnpm/worker";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";

export type DependencyProject = {
  rootDir: string;
  manifest: ProjectManifest;
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
};

export async function installDependencyProjects(options: InstallDependencyProjectsOptions) {
  const { config } = await getConfig({
    cliOptions: {
      dir: options.rootDir,
      ignoreScripts: true,
    },
    packageManager: {
      name: "pnpm",
      version: "11.7.0",
    },
  });
  const store = await createOrConnectStoreController({
    ...config,
    dir: options.rootDir,
    workspaceDir: options.rootDir,
  });
  const allProjects: ProjectOptions[] = options.projects.map((project) => ({
    buildIndex: 0,
    manifest: project.manifest,
    rootDir: project.rootDir as ProjectRootDir,
  }));
  const workspacePackages = createWorkspacePackageMap(options.workspacePackages ?? []);
  const mutations: MutatedProject[] = options.projects.map((project) => ({
    rootDir: project.rootDir as ProjectRootDir,
    mutation: "install",
  }));
  const installOptions: InstallOptions = {
    allProjects,
    autoInstallPeers: false,
    autoInstallPeersFromHighestMatch: false,
    confirmModulesPurge: false,
    dedupeDirectDeps: true,
    dedupePeerDependents: true,
    depth: 0,
    dir: options.rootDir,
    enableModulesDir: true,
    excludeLinksFromLockfile: true,
    hoistPattern: [],
    ignoreScripts: true,
    include: {
      dependencies: true,
      devDependencies: true,
      optionalDependencies: true,
    },
    injectWorkspacePackages: false,
    linkWorkspacePackagesDepth: workspacePackages.size > 0 ? 0 : -1,
    lockfileOnly: false,
    modulesCacheMaxAge: Infinity,
    nodeLinker: "isolated",
    preferFrozenLockfile: true,
    preferWorkspacePackages: workspacePackages.size > 0,
    pruneLockfileImporters: true,
    rawConfig: config.rawConfig,
    registries: config.registries,
    resolutionMode: "highest",
    resolvePeersFromWorkspaceRoot: false,
    storeController: store.ctrl,
    storeDir: store.dir,
    strictPeerDependencies: false,
    workspacePackages,
  };

  try {
    await restartWorkerPool();
    await mutateModules(mutations, installOptions);
  } finally {
    await finishWorkers();
  }
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
      projects.push({ rootDir, manifest: manifest as ProjectManifest });
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT")) throw error;
    }
  }
  return projects;
}

function createWorkspacePackageMap(projects: DependencyProject[]) {
  const result = new Map<string, Map<string, { rootDir: ProjectRootDir; manifest: ProjectManifest }>>();
  for (const project of projects) {
    const name = typeof project.manifest.name === "string" ? project.manifest.name : undefined;
    const version = typeof project.manifest.version === "string" ? project.manifest.version : undefined;
    if (!name || !version) continue;
    const versions = result.get(name) ?? new Map();
    versions.set(version, { rootDir: project.rootDir as ProjectRootDir, manifest: project.manifest });
    result.set(name, versions);
  }
  return result as NonNullable<InstallOptions["workspacePackages"]>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

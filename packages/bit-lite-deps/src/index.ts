import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isRecord } from "bit-lite-utils";
import { isNodeErrorCode } from "bit-lite-utils/node";
import fg from "fast-glob";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { runPnpmInstall } from "./pnpm-cli.js";
import {
  createDependencyProgressReader,
  type DependencyInstallProgressEvent,
} from "./progress.js";

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
  const workspacePackages = options.workspacePackages ?? [];
  await writeInstallWorkspaceFile(options.rootDir, options.projects, workspacePackages);

  const reader = options.onProgress
    ? createDependencyProgressReader(options.rootDir, options.onProgress)
    : undefined;
  try {
    await runPnpmInstall({
      cwd: options.rootDir,
      filters: createInstallFilters(options.rootDir, options.projects),
      ...(reader === undefined ? {} : { onOutput: (chunk: string) => reader.write(chunk) }),
    });
  } finally {
    reader?.end();
  }
}

/**
 * Writes the generated workspace file that drives the install. Every project and
 * every linkable local package is listed here, and the settings reproduce the
 * install behaviour bit-lite previously configured through the programmatic API.
 */
async function writeInstallWorkspaceFile(
  rootDir: string,
  projects: DependencyProject[],
  workspacePackages: DependencyProject[]
) {
  const linkWorkspacePackages = workspacePackages.length > 0;
  const settings = {
    packages: collectWorkspacePatterns(rootDir, [...projects, ...workspacePackages]),
    autoInstallPeers: false,
    confirmModulesPurge: false,
    dedupeDirectDeps: true,
    dedupePeerDependents: true,
    excludeLinksFromLockfile: true,
    hoist: false,
    ignoreScripts: true,
    injectWorkspacePackages: false,
    linkWorkspacePackages,
    // Approximates the unbounded cache age bit-lite used before: keep orphaned
    // packages around instead of re-fetching them on the next install.
    modulesCacheMaxAge: 525_600,
    nodeLinker: "isolated",
    preferWorkspacePackages: linkWorkspacePackages,
    resolutionMode: "highest",
    resolvePeersFromWorkspaceRoot: false,
    strictPeerDependencies: false,
  };
  await writeFile(path.join(rootDir, "pnpm-workspace.yaml"), stringifyYaml(settings), "utf8");
}

/**
 * Turns project directories into workspace patterns relative to the install root.
 * The root is always a project itself, and local packages resolved from an
 * enclosing repository are referenced through `..` segments.
 */
function collectWorkspacePatterns(rootDir: string, projects: DependencyProject[]) {
  const patterns = new Set<string>();
  for (const project of projects) {
    const relative = toWorkspaceRelativePath(rootDir, project.rootDir);
    if (relative === "") continue;
    patterns.add(relative);
  }
  return [...patterns].sort();
}

/**
 * Restricts the install to bit-lite's own projects. Local packages discovered in
 * an enclosing repository have to be workspace members to stay linkable, but
 * installing them would repoint that repository's own `node_modules` at the
 * store generated here.
 */
function createInstallFilters(rootDir: string, projects: DependencyProject[]) {
  const filters = new Set<string>();
  for (const project of projects) {
    const relative = toWorkspaceRelativePath(rootDir, project.rootDir);
    // A leading `./` is what makes pnpm read the filter as a path instead of a
    // package name pattern.
    filters.add(relative === "" ? "." : `./${relative}`);
  }
  return [...filters].sort();
}

function toWorkspaceRelativePath(rootDir: string, dir: string) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(dir));
  return relative.split(path.sep).join("/");
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

import { access, lstat, mkdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isWorkspaceProtocolSpec,
  readWorkspace,
} from "bit-lite-context";
import { isRecord, sortStringRecord } from "bit-lite-utils";
import { isNodeErrorCode, readJsonFile } from "bit-lite-utils/node";
import type {
  PackageRef,
  ParsedCliArgs,
  Workspace,
  WorkspaceComponent,
} from "bit-lite-context";
import { BitLiteError } from "../utils/errors.js";

export type { PackageRef, Workspace, WorkspaceComponent } from "bit-lite-context";
export { isWorkspaceProtocolSpec, readWorkspace };
export { sortStringRecord };

export async function runLinkCommand(parsed: ParsedCliArgs) {
  const workspace = await readWorkspace(parsed.workspaceRoot);
  await linkComponentPackages(workspace);
  console.log(`Linked ${workspace.components.length} component package${workspace.components.length === 1 ? "" : "s"}.`);
  for (const component of workspace.components) console.log(`- ${component.id} -> ${component.packageName}`);
}

export async function linkComponentPackages(workspace: Workspace) {
  const versions = readComponentVersions(workspace);
  for (const component of workspace.components) {
    const packageDir = getPackageDirectory(workspace.rootDir, component.packageName);
    await preparePackageDirectory(packageDir, component);
    await writeJsonFile(
      path.join(packageDir, "package.json"),
      createGeneratedPackageManifest(component, versions)
    );
    await ensureSourceSymlink(packageDir, component.rootDir);
    await ensureComponentDependencyLinks(workspace.rootDir, packageDir, component);
    await mkdir(path.join(packageDir, "dist"), { recursive: true });
  }
}

export function getPackageDirectory(workspaceRoot: string, packageName: string) {
  return path.join(workspaceRoot, "node_modules", ...packageName.split("/"));
}

export function getComponentDependencyDirectory(workspaceRoot: string, packageName: string) {
  return path.join(workspaceRoot, ".bit-lite", "deps", "components", ...packageName.split("/"));
}

export async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Version anchors read from the workspace configuration, keyed by package name.
 *
 * A generated manifest describes what is actually linked right now, so a local
 * dependency is declared at the version that dependency currently carries
 * rather than anything recorded in history. Linking therefore never opens the
 * component history store; the anchors on disk are all it needs. They can be
 * briefly stale after `sync` fast-forwards a head, which costs nothing today
 * because resolution happens through symlinks rather than through these
 * versions.
 */
export const unrecordedComponentVersion = "0.0.0";

function readComponentVersions(workspace: Workspace): ReadonlyMap<string, string> {
  return new Map(
    workspace.components.map((component) => [
      component.packageName,
      component.version ?? unrecordedComponentVersion,
    ])
  );
}

function resolveManifestDependencies(
  dependencies: Record<string, string>,
  versions: ReadonlyMap<string, string>
): Record<string, string> {
  return sortStringRecord(
    Object.fromEntries(
      Object.entries(dependencies).map(([packageName, version]) => [
        packageName,
        isWorkspaceProtocolSpec(version)
          ? versions.get(packageName) ?? unrecordedComponentVersion
          : version,
      ])
    )
  );
}

function createGeneratedPackageManifest(
  component: WorkspaceComponent,
  versions: ReadonlyMap<string, string>
) {
  const entry = component.kind === "env" ? "./dist/index.json" : "./dist/index.js";
  const manifest: Record<string, unknown> = {
    name: component.packageName,
    version: component.version ?? unrecordedComponentVersion,
    type: "module",
    main: entry,
    exports: { ".": entry },
    dependencies: resolveManifestDependencies(component.dependencies, versions),
    bitLite: {
      componentId: component.id,
      kind: component.kind,
      source: component.path,
      generated: true,
    },
  };
  if (component.kind === "component") {
    manifest.types = "./dist/index.d.ts";
    manifest.exports = {
      ".": {
        types: "./dist/index.d.ts",
        import: entry,
        default: entry,
      },
    };
  }
  if (Object.keys(component.peerDependencies).length > 0) {
    manifest.peerDependencies = resolveManifestDependencies(component.peerDependencies, versions);
  }
  return manifest;
}

async function preparePackageDirectory(packageDir: string, component: WorkspaceComponent) {
  await mkdir(path.dirname(packageDir), { recursive: true });
  try {
    const stats = await lstat(packageDir);
    if (stats.isSymbolicLink()) {
      await rm(packageDir, { recursive: true, force: true });
      await mkdir(packageDir, { recursive: true });
      return;
    }
    if (!stats.isDirectory()) {
      throw new BitLiteError(`cannot link ${component.packageName}: ${packageDir} exists and is not a directory`);
    }
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      await mkdir(packageDir, { recursive: true });
      return;
    }
    throw error;
  }

  const existingManifestPath = path.join(packageDir, "package.json");
  try {
    const existingManifest = await readJsonFile(existingManifestPath, {
      mapParseError: (error) =>
        new BitLiteError(
          `failed parsing ${existingManifestPath}: ${
            error instanceof Error ? error.message : String(error)
          }`
        ),
    });
    if (isRecord(existingManifest) && typeof existingManifest.name === "string" && existingManifest.name !== component.packageName) {
      throw new BitLiteError(
        `cannot link ${component.packageName}: ${packageDir} already belongs to ${existingManifest.name}`
      );
    }
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) throw error;
  }
}

async function ensureSourceSymlink(packageDir: string, componentRootDir: string) {
  const sourceLink = path.join(packageDir, "src");
  await rm(sourceLink, { recursive: true, force: true });
  await symlink(path.relative(packageDir, componentRootDir), sourceLink, "dir");
}

async function ensureComponentDependencyLinks(
  workspaceRoot: string,
  packageDir: string,
  component: WorkspaceComponent
) {
  const dependencyDir = path.join(getComponentDependencyDirectory(workspaceRoot, component.packageName), "node_modules");
  await mkdir(dependencyDir, { recursive: true });
  const internalToolingPackages = new Set([
    ...component.internalDependencyPackageNames,
    ...(component.internalEnvPackageName ? [component.internalEnvPackageName] : []),
  ]);
  for (const packageName of [...internalToolingPackages].sort()) {
    await replacePackageSymlink(
      path.join(dependencyDir, ...packageName.split("/")),
      getPackageDirectory(workspaceRoot, packageName),
      component.packageName
    );
  }
  const destinations = [path.join(packageDir, "node_modules"), path.join(component.rootDir, "node_modules")];
  for (const destination of destinations) {
    await replaceManagedDirectorySymlink(destination, dependencyDir, component.packageName);
  }
}

async function replacePackageSymlink(destination: string, source: string, ownerPackageName: string) {
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    const stats = await lstat(destination);
    if (!stats.isSymbolicLink()) {
      throw new BitLiteError(
        `cannot link internal dependency for ${ownerPackageName}: ${destination} exists and is not a symlink`
      );
    }
    await rm(destination, { recursive: true, force: true });
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) throw error;
  }
  await symlink(path.relative(path.dirname(destination), source), destination, "dir");
}

async function replaceManagedDirectorySymlink(destination: string, source: string, packageName: string) {
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    const stats = await lstat(destination);
    if (!stats.isSymbolicLink()) {
      throw new BitLiteError(`cannot link dependencies for ${packageName}: ${destination} exists and is not a symlink`);
    }
    if (!(await symlinkPointsTo(destination, source))) {
      throw new BitLiteError(`cannot link dependencies for ${packageName}: ${destination} is not managed by bit-lite`);
    }
    await rm(destination, { recursive: true, force: true });
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) throw error;
  }
  await symlink(path.relative(path.dirname(destination), source), destination, "dir");
}

async function removeManagedDependencyLink(destination: string, source: string) {
  try {
    const stats = await lstat(destination);
    if (stats.isSymbolicLink() && (await symlinkPointsTo(destination, source))) {
      await rm(destination, { force: true });
    }
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) throw error;
  }
}

async function symlinkPointsTo(linkPath: string, expectedTarget: string) {
  const target = await readlink(linkPath);
  return path.resolve(path.dirname(linkPath), target) === path.resolve(expectedTarget);
}

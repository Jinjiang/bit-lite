import { lstat, mkdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getComponentDependencyDirectory,
  getLinkedPackageDirectory,
  isWorkspaceProtocolSpec,
  readWorkspace,
} from "bit-lite-context";
import { BitLiteError, countOf, isRecord, sortStringRecord } from "bit-lite-utils";
import { isNodeErrorCode, readJsonFile } from "bit-lite-utils/node";
import { unrecordedComponentVersion } from "bit-lite-versioning";
import type { Workspace, WorkspaceComponent } from "bit-lite-context";
import type { ParsedCliArgs } from "../cli/arg-types.js";

export async function runLinkCommand(parsed: ParsedCliArgs) {
  const workspace = await readWorkspace(parsed.workspaceRoot);
  await linkComponentPackages(workspace);
  console.log(`Linked ${countOf(workspace.components.length, "component package")}.`);
  for (const component of workspace.components) console.log(`- ${component.id} -> ${component.packageName}`);
}

export async function linkComponentPackages(workspace: Workspace) {
  const versions = readComponentVersions(workspace);
  for (const component of workspace.components) {
    const packageDir = getLinkedPackageDirectory(workspace.rootDir, component.packageName);
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

/**
 * Makes sure the package directory is one Bit Lite may write into. A stale
 * symlink from an earlier layout is replaced; a real directory belonging to
 * another package is refused, because overwriting it would delete something
 * this command did not generate.
 */
async function preparePackageDirectory(packageDir: string, component: WorkspaceComponent) {
  await mkdir(path.dirname(packageDir), { recursive: true });

  const existing = await lstatOrUndefined(packageDir);
  if (existing?.isDirectory() !== true) {
    if (existing?.isSymbolicLink() === true) await rm(packageDir, { recursive: true, force: true });
    else if (existing !== undefined) {
      throw new BitLiteError(
        `cannot link ${component.packageName}: ${packageDir} exists and is not a directory`
      );
    }
    await mkdir(packageDir, { recursive: true });
    return;
  }

  const owner = await readPackageDirectoryOwner(path.join(packageDir, "package.json"));
  if (owner !== undefined && owner !== component.packageName) {
    throw new BitLiteError(
      `cannot link ${component.packageName}: ${packageDir} already belongs to ${owner}`
    );
  }
}

async function readPackageDirectoryOwner(manifestPath: string): Promise<string | undefined> {
  let manifest: unknown;
  try {
    manifest = await readJsonFile(manifestPath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
  return isRecord(manifest) && typeof manifest.name === "string" ? manifest.name : undefined;
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
    await replaceOwnedSymlink(
      path.join(dependencyDir, ...packageName.split("/")),
      getLinkedPackageDirectory(workspaceRoot, packageName),
      "generated-tree",
      `cannot link internal dependency for ${component.packageName}`
    );
  }
  for (const destination of [
    path.join(packageDir, "node_modules"),
    path.join(component.rootDir, "node_modules"),
  ]) {
    await replaceOwnedSymlink(
      destination,
      dependencyDir,
      "user-directory",
      `cannot link dependencies for ${component.packageName}`
    );
  }
}

/**
 * Where a link lives decides how much the linker may assume about it.
 *
 * A link inside Bit Lite's own generated tree is owned by its location, so
 * whatever is there may be replaced. A link written into a directory the user
 * owns — a component's `node_modules` — has to prove it was Bit Lite that
 * created it, or the linker would quietly delete something it did not put there.
 */
type SymlinkOwnership = "generated-tree" | "user-directory";

async function replaceOwnedSymlink(
  destination: string,
  source: string,
  ownership: SymlinkOwnership,
  reason: string
) {
  await mkdir(path.dirname(destination), { recursive: true });

  const existing = await lstatOrUndefined(destination);
  if (existing !== undefined) {
    if (!existing.isSymbolicLink()) {
      throw new BitLiteError(`${reason}: ${destination} exists and is not a symlink`);
    }
    if (ownership === "user-directory" && !(await symlinkPointsTo(destination, source))) {
      throw new BitLiteError(`${reason}: ${destination} is not managed by bit-lite`);
    }
    await rm(destination, { recursive: true, force: true });
  }

  await symlink(path.relative(path.dirname(destination), source), destination, "dir");
}

async function lstatOrUndefined(filePath: string) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function symlinkPointsTo(linkPath: string, expectedTarget: string) {
  const target = await readlink(linkPath);
  return path.resolve(path.dirname(linkPath), target) === path.resolve(expectedTarget);
}

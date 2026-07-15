import { access, lstat, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isWorkspaceProtocolSpec,
  loadComponentPackageRegistry,
  orderComponentsByInternalDependencies,
} from "bit-lite-context";
import type {
  ComponentPackage,
  ComponentPackageRegistry,
  PackageRef,
  ParsedCliArgs,
} from "bit-lite-context";
import { BitLiteError } from "../utils/errors.js";

export type { ComponentPackage, ComponentPackageRegistry, PackageRef } from "bit-lite-context";
export { isWorkspaceProtocolSpec, loadComponentPackageRegistry, orderComponentsByInternalDependencies };

export async function runLinkCommand(parsed: ParsedCliArgs) {
  const registry = await loadComponentPackageRegistry(parsed.workspaceRoot);
  await linkComponentPackages(registry);
  console.log(`Linked ${registry.components.length} component package${registry.components.length === 1 ? "" : "s"}.`);
  for (const component of registry.components) console.log(`- ${component.id} -> ${component.packageName}`);
}

export async function linkComponentPackages(registry: ComponentPackageRegistry) {
  for (const component of registry.components) {
    const packageDir = getPackageDirectory(registry.workspaceRoot, component.packageName);
    await preparePackageDirectory(packageDir, component);
    await writeJsonFile(path.join(packageDir, "package.json"), createGeneratedPackageManifest(component));
    await ensureSourceSymlink(packageDir, component.rootDir);
    await ensureComponentDependencyLinks(registry.workspaceRoot, packageDir, component);
    await mkdir(path.join(packageDir, "dist"), { recursive: true });
  }
}

export function getPackageDirectory(workspaceRoot: string, packageName: string) {
  return path.join(workspaceRoot, "node_modules", ...packageName.split("/"));
}

export function getComponentDependencyDirectory(workspaceRoot: string, packageName: string) {
  return path.join(workspaceRoot, ".bit-lite", "deps", "components", ...packageName.split("/"));
}

export function sortStringRecord(record: Record<string, string>) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

export async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createGeneratedPackageManifest(component: ComponentPackage) {
  const entry = component.kind === "env" ? "./dist/index.json" : "./dist/index.js";
  const manifest: Record<string, unknown> = {
    name: component.packageName,
    version: "0.0.0",
    type: "module",
    main: entry,
    exports: { ".": entry },
    dependencies: sortStringRecord(component.dependencies),
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
    manifest.peerDependencies = sortStringRecord(component.peerDependencies);
  }
  return manifest;
}

async function preparePackageDirectory(packageDir: string, component: ComponentPackage) {
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
    const existingManifest = await readJsonFile(existingManifestPath, `failed parsing ${existingManifestPath}`);
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
  component: ComponentPackage
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

async function readJsonFile(filePath: string, errorPrefix: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BitLiteError(`${errorPrefix}: ${message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

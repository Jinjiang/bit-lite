import { access, lstat, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ParsedCliArgs } from "bit-lite-context";
import { BitLiteError } from "../utils/errors.js";

const configFileName = "bit-lite.json";
const componentConfigFileName = ".comp.json";
const packageEntryCandidates = [
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
  "index.mjs",
  "index.cjs",
  "index.esm.js",
  "index.vue",
];

export type PackageRef = {
  packageName: string;
  version: string;
};

export type ComponentPackage = {
  id: string;
  path: string;
  rootDir: string;
  packageName: string;
  env: PackageRef | undefined;
  mainFile: string;
  mainFileRelative: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  internalDependencyPackageNames: string[];
};

export type ComponentPackageRegistry = {
  workspaceRoot: string;
  configPath: string;
  components: ComponentPackage[];
  byId: Map<string, ComponentPackage>;
  byPackageName: Map<string, ComponentPackage>;
};

type ComponentEntry = {
  path: string;
  id: string;
  packageName: string | undefined;
  env: PackageRef | undefined;
};

type ComponentPackageConfig = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
};

export async function runLinkCommand(parsed: ParsedCliArgs) {
  const registry = await loadComponentPackageRegistry(parsed.workspaceRoot);
  await linkComponentPackages(registry);

  console.log(`Linked ${registry.components.length} component package${registry.components.length === 1 ? "" : "s"}.`);
  for (const component of registry.components) {
    console.log(`- ${component.id} -> ${component.packageName}`);
  }
}

export async function loadComponentPackageRegistry(workspaceRoot: string): Promise<ComponentPackageRegistry> {
  const absoluteRoot = path.resolve(workspaceRoot);
  const configPath = path.join(absoluteRoot, configFileName);
  const rawConfig = await readJsonFile(configPath, `failed parsing ${configFileName}`);
  if (!isRecord(rawConfig)) throw new BitLiteError(`${configFileName} must contain an object`);

  const defaultScope = readDefaultScope(rawConfig);
  const entries = readComponentEntries(rawConfig, defaultScope);
  if (entries.length === 0) throw new BitLiteError(`${configFileName} must define at least one component`);

  const byId = new Map<string, ComponentPackage>();
  const byPackageName = new Map<string, ComponentPackage>();
  const components: ComponentPackage[] = [];

  for (const entry of entries) {
    const rootDir = resolveInsideWorkspace(absoluteRoot, entry.path, `component "${entry.id}" path`);
    await assertDirectory(rootDir, `component "${entry.id}" path does not exist: ${entry.path}`);
    const mainFile = await findMainFile(rootDir, entry.id);
    const compConfig = await readComponentPackageConfig(rootDir, entry.id);
    const packageName = entry.packageName ?? packageNameFromComponentId(entry.id, defaultScope);

    assertComponentId(entry.id);
    assertPackageName(packageName);
    if (byId.has(entry.id)) throw new BitLiteError(`duplicate component id "${entry.id}"`);
    if (byPackageName.has(packageName)) throw new BitLiteError(`duplicate package name "${packageName}"`);

    const component: ComponentPackage = {
      id: entry.id,
      path: toPosixPath(path.relative(absoluteRoot, rootDir)),
      rootDir,
      packageName,
      env: entry.env,
      mainFile,
      mainFileRelative: toPosixPath(path.relative(rootDir, mainFile)),
      dependencies: compConfig.dependencies,
      devDependencies: compConfig.devDependencies,
      peerDependencies: compConfig.peerDependencies,
      internalDependencyPackageNames: [],
    };
    components.push(component);
    byId.set(component.id, component);
    byPackageName.set(component.packageName, component);
  }

  for (const component of components) {
    component.internalDependencyPackageNames = Object.entries(component.dependencies)
      .filter(([, version]) => isWorkspaceProtocolSpec(version))
      .map(([packageName]) => {
        if (!byPackageName.has(packageName)) {
          throw new BitLiteError(
            `component "${component.id}" declares internal dependency "${packageName}" but no such component package exists`
          );
        }
        return packageName;
      });
  }

  return {
    workspaceRoot: absoluteRoot,
    configPath,
    components: components.sort((left, right) => left.id.localeCompare(right.id)),
    byId,
    byPackageName,
  };
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

export function orderComponentsByInternalDependencies(registry: ComponentPackageRegistry): ComponentPackage[] {
  const ordered: ComponentPackage[] = [];
  const permanent = new Set<string>();
  const temporary = new Set<string>();

  const visit = (component: ComponentPackage, stack: string[]) => {
    if (permanent.has(component.packageName)) return;
    if (temporary.has(component.packageName)) {
      const cycle = [...stack, component.packageName].join(" -> ");
      throw new BitLiteError(`component package dependency cycle detected: ${cycle}`);
    }

    temporary.add(component.packageName);
    for (const dependencyPackageName of component.internalDependencyPackageNames) {
      const dependency = registry.byPackageName.get(dependencyPackageName);
      if (!dependency) throw new BitLiteError(`missing internal dependency "${dependencyPackageName}"`);
      visit(dependency, [...stack, component.packageName]);
    }
    temporary.delete(component.packageName);
    permanent.add(component.packageName);
    ordered.push(component);
  };

  for (const component of registry.components) {
    visit(component, []);
  }

  return ordered;
}

export function getPackageDirectory(workspaceRoot: string, packageName: string) {
  return path.join(workspaceRoot, "node_modules", ...packageName.split("/"));
}

export function getComponentDependencyDirectory(workspaceRoot: string, packageName: string) {
  return path.join(workspaceRoot, ".bit-lite", "deps", "components", ...packageName.split("/"));
}

export function isWorkspaceProtocolSpec(version: string) {
  return version === "workspace:*" || version.startsWith("workspace:");
}

export function sortStringRecord(record: Record<string, string>) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

export async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createGeneratedPackageManifest(component: ComponentPackage) {
  const manifest: Record<string, unknown> = {
    name: component.packageName,
    version: "0.0.0",
    type: "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        default: "./dist/index.js",
      },
    },
    dependencies: sortStringRecord(component.dependencies),
    bitLite: {
      componentId: component.id,
      source: component.path,
      generated: true,
    },
  };

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
  const relativeTarget = path.relative(packageDir, componentRootDir);
  await symlink(relativeTarget, sourceLink, "dir");
}

async function ensureComponentDependencyLinks(
  workspaceRoot: string,
  packageDir: string,
  component: ComponentPackage
) {
  const dependencyDir = path.join(
    getComponentDependencyDirectory(workspaceRoot, component.packageName),
    "node_modules"
  );
  const destinations = [path.join(packageDir, "node_modules"), path.join(component.rootDir, "node_modules")];

  try {
    await access(dependencyDir);
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) throw error;
    for (const destination of destinations) {
      await removeManagedDependencyLink(destination, dependencyDir);
    }
    return;
  }

  for (const destination of destinations) {
    await replaceManagedDirectorySymlink(destination, dependencyDir, component.packageName);
  }
}

async function replaceManagedDirectorySymlink(destination: string, source: string, packageName: string) {
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    const stats = await lstat(destination);
    if (!stats.isSymbolicLink()) {
      throw new BitLiteError(
        `cannot link dependencies for ${packageName}: ${destination} exists and is not a symlink`
      );
    }
    if (!(await symlinkPointsTo(destination, source))) {
      throw new BitLiteError(
        `cannot link dependencies for ${packageName}: ${destination} is not managed by bit-lite`
      );
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

async function readComponentPackageConfig(rootDir: string, componentId: string): Promise<ComponentPackageConfig> {
  const configPath = path.join(rootDir, componentConfigFileName);
  const parsed = await readJsonFile(configPath, `failed parsing ${componentConfigFileName} for component "${componentId}"`);
  if (!isRecord(parsed)) throw new BitLiteError(`${componentConfigFileName} for component "${componentId}" must be an object`);

  return {
    dependencies: readDependencyMap(parsed.dependencies, `${componentConfigFileName} dependencies for component "${componentId}"`),
    devDependencies: readDependencyMap(
      parsed.devDependencies,
      `${componentConfigFileName} devDependencies for component "${componentId}"`
    ),
    peerDependencies: readDependencyMap(
      parsed.peerDependencies,
      `${componentConfigFileName} peerDependencies for component "${componentId}"`
    ),
  };
}

function readComponentEntries(config: Record<string, unknown>, defaultScope: string | undefined): ComponentEntry[] {
  const components = config.components;
  if (Array.isArray(components)) {
    return components.map((entry, index) => readComponentEntry(entry, index, defaultScope));
  }

  if (isRecord(components)) {
    return Object.entries(components).map(([componentPath, envName]) => {
      if (typeof envName !== "string") {
        throw new BitLiteError(`legacy component entry "${componentPath}" must map to an env name`);
      }
      const id = componentPathToId(componentPath);
      return {
        path: componentPath,
        id,
        packageName: packageNameFromComponentId(id, defaultScope),
        env: {
          packageName: envName,
          version: "workspace:*",
        },
      };
    });
  }

  throw new BitLiteError(`${configFileName} field "components" must be an array`);
}

function readComponentEntry(entry: unknown, index: number, defaultScope: string | undefined): ComponentEntry {
  if (!isRecord(entry)) throw new BitLiteError(`component entry at index ${index} must be an object`);

  const componentPath = readRequiredString(entry.path, `component entry at index ${index} field "path"`);
  const id = readRequiredString(entry.id, `component entry at index ${index} field "id"`);
  const explicitPackageName = readOptionalString(entry.packageName, `component "${id}" field "packageName"`);

  return {
    path: componentPath,
    id,
    packageName: explicitPackageName ?? packageNameFromComponentId(id, defaultScope),
    env: readOptionalPackageRef(entry.env, `component "${id}" field "env"`),
  };
}

function readOptionalPackageRef(value: unknown, label: string): PackageRef | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new BitLiteError(`${label} must be an object`);
  const packageName = readRequiredString(value.packageName, `${label}.packageName`);
  assertPackageName(packageName);

  return {
    packageName,
    version: readRequiredString(value.version, `${label}.version`),
  };
}

function readDependencyMap(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new BitLiteError(`${label} must be an object`);

  const result: Record<string, string> = {};
  for (const [name, version] of Object.entries(value)) {
    if (typeof version !== "string" || version.length === 0) {
      throw new BitLiteError(`${label} dependency "${name}" must have a version string`);
    }
    assertPackageName(name);
    result[name] = version;
  }
  return sortStringRecord(result);
}

function readDefaultScope(config: Record<string, unknown>) {
  const value = config.defaultScope ?? config.packageScope ?? config.scope;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new BitLiteError(`${configFileName} field "defaultScope" must be a string`);
  }
  return normalizePackageScope(value);
}

async function findMainFile(rootDir: string, componentId: string) {
  for (const candidate of packageEntryCandidates) {
    const filePath = path.join(rootDir, candidate);
    try {
      await access(filePath);
      return filePath;
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT")) throw error;
    }
  }

  throw new BitLiteError(
    `component "${componentId}" does not have a supported entry file (${packageEntryCandidates.join(", ")})`
  );
}

async function assertDirectory(dir: string, message: string) {
  try {
    const stats = await lstat(dir);
    if (!stats.isDirectory()) throw new BitLiteError(message);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) throw new BitLiteError(message);
    throw error;
  }
}

async function readJsonFile(filePath: string, errorPrefix: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT") && path.basename(filePath) === componentConfigFileName) {
      throw new BitLiteError(`component is missing ${componentConfigFileName}: ${filePath}`);
    }
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BitLiteError(`${errorPrefix}: ${message}`);
  }
}

function resolveInsideWorkspace(workspaceRoot: string, relativePath: string, label: string) {
  if (path.isAbsolute(relativePath)) throw new BitLiteError(`${label} must be relative`);
  const resolved = path.resolve(workspaceRoot, relativePath);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new BitLiteError(`${label} must stay inside the workspace`);
  }
  return resolved;
}

function packageNameFromComponentId(componentId: string, defaultScope: string | undefined) {
  const parts = componentId.split("/").filter(Boolean);
  if (parts.length === 0) throw new BitLiteError("component id must not be empty");

  if (defaultScope) {
    return `@${defaultScope}/${parts.join(".")}`;
  }

  if (parts.length > 1) {
    const [scope, ...nameParts] = parts;
    if (!scope) throw new BitLiteError(`cannot derive package name from component id "${componentId}"`);
    return `@${normalizePackageScope(scope)}/${nameParts.join(".")}`;
  }

  const [name] = parts;
  if (!name) throw new BitLiteError(`cannot derive package name from component id "${componentId}"`);
  return name;
}

function componentPathToId(componentPath: string) {
  const parts = toPosixPath(componentPath).split("/").filter(Boolean);
  const componentsIndex = parts.indexOf("components");
  return (componentsIndex >= 0 ? parts.slice(componentsIndex + 1) : parts).join("/");
}

function assertComponentId(id: string) {
  if (id.length === 0 || id.startsWith("/") || id.endsWith("/") || id.includes("//")) {
    throw new BitLiteError(`invalid component id "${id}"`);
  }
}

function assertPackageName(name: string) {
  const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
  if (!packageNamePattern.test(name) || name.length > 214) {
    throw new BitLiteError(`invalid npm package name "${name}"`);
  }
}

function normalizePackageScope(scope: string) {
  const normalized = scope.startsWith("@") ? scope.slice(1) : scope;
  const scopePattern = /^[a-z0-9][a-z0-9._-]*$/;
  if (!scopePattern.test(normalized)) throw new BitLiteError(`invalid npm package scope "${scope}"`);
  return normalized;
}

function readRequiredString(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) throw new BitLiteError(`${label} must be a string`);
  return value;
}

function readOptionalString(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new BitLiteError(`${label} must be a string`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

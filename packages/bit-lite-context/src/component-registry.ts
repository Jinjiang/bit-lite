import { access, lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { assertPackageName, CONFIG_FILE, isWorkspaceProtocolSpec, loadConfig } from "./config.js";
import type {
  ComponentKind,
  ComponentPackage,
  ComponentPackageRegistry,
  WorkspaceComponentConfig,
} from "./types/index.js";
import { BitLiteError } from "./utils/errors.js";
import { toPosixPath } from "./utils/path-utils.js";

const componentConfigFileName = ".comp.json";
const ordinaryEntryCandidates = [
  "index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs", "index.esm.js", "index.vue",
];

type ComponentPackageConfig = {
  kind: ComponentKind;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
};

export async function loadComponentPackageRegistry(workspaceRoot: string): Promise<ComponentPackageRegistry> {
  const absoluteRoot = path.resolve(workspaceRoot);
  const config = await loadConfig(absoluteRoot);
  const configPath = path.join(absoluteRoot, CONFIG_FILE);
  const byId = new Map<string, ComponentPackage>();
  const byPackageName = new Map<string, ComponentPackage>();
  const components: ComponentPackage[] = [];

  for (const entry of config.components) {
    const rootDir = resolveInsideWorkspace(absoluteRoot, entry.path, `component "${entry.id}" path`);
    await assertDirectory(rootDir, `component "${entry.id}" path does not exist: ${entry.path}`);
    const packageConfig = await readComponentPackageConfig(rootDir, entry.id);
    const mainFile = await findMainFile(rootDir, entry.id, packageConfig.kind);
    const component: ComponentPackage = {
      id: entry.id,
      path: toPosixPath(path.relative(absoluteRoot, rootDir)),
      rootDir,
      packageName: entry.packageName,
      kind: packageConfig.kind,
      env: entry.env,
      mainFile,
      mainFileRelative: toPosixPath(path.relative(rootDir, mainFile)),
      dependencies: packageConfig.dependencies,
      devDependencies: packageConfig.devDependencies,
      peerDependencies: packageConfig.peerDependencies,
      internalDependencyPackageNames: [],
      internalEnvPackageName: undefined,
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
            `component "${component.id}" declares internal dependency "${packageName}" but no such component exists`
          );
        }
        return packageName;
      });

    const explicitDevVersion = component.devDependencies[component.env.packageName];
    if (explicitDevVersion !== undefined && explicitDevVersion !== component.env.version) {
      throw new BitLiteError(
        `component "${component.id}" env "${component.env.packageName}@${component.env.version}" conflicts with ` +
        `.comp.json devDependency version "${explicitDevVersion}"`
      );
    }
    const runtimeVersion = component.dependencies[component.env.packageName];
    if (runtimeVersion !== undefined && runtimeVersion !== component.env.version) {
      throw new BitLiteError(
        `component "${component.id}" env "${component.env.packageName}@${component.env.version}" conflicts with ` +
        `.comp.json runtime dependency version "${runtimeVersion}"`
      );
    }

    if (isWorkspaceProtocolSpec(component.env.version)) {
      const target = byPackageName.get(component.env.packageName);
      if (!target) {
        throw new BitLiteError(
          `component "${component.id}" references local env "${component.env.packageName}" but no such Bit component exists`
        );
      }
      if (target.kind !== "env") {
        throw new BitLiteError(
          `component "${component.id}" references "${component.env.packageName}" as an env but the target is not kind "env"`
        );
      }
      component.internalEnvPackageName = target.packageName;
    }
  }

  return {
    workspaceRoot: absoluteRoot,
    configPath,
    config,
    components,
    byId,
    byPackageName,
  };
}

export function orderComponentsByInternalDependencies(
  registry: ComponentPackageRegistry,
  components: ComponentPackage[] = registry.components
) {
  const included = new Set(components.map((component) => component.packageName));
  const ordered: ComponentPackage[] = [];
  const permanent = new Set<string>();
  const temporary = new Set<string>();

  const visit = (component: ComponentPackage, stack: string[]) => {
    if (permanent.has(component.packageName)) return;
    if (temporary.has(component.packageName)) {
      throw new BitLiteError(`component package dependency cycle detected: ${[...stack, component.packageName].join(" -> ")}`);
    }
    temporary.add(component.packageName);
    for (const dependencyPackageName of component.internalDependencyPackageNames) {
      if (!included.has(dependencyPackageName)) continue;
      const dependency = registry.byPackageName.get(dependencyPackageName);
      if (!dependency) throw new BitLiteError(`missing internal dependency "${dependencyPackageName}"`);
      visit(dependency, [...stack, component.packageName]);
    }
    temporary.delete(component.packageName);
    permanent.add(component.packageName);
    ordered.push(component);
  };
  for (const component of components) visit(component, []);
  return ordered;
}

async function readComponentPackageConfig(rootDir: string, componentId: string): Promise<ComponentPackageConfig> {
  const configPath = path.join(rootDir, componentConfigFileName);
  const parsed = await readJsonFile(configPath, `failed parsing ${componentConfigFileName} for component "${componentId}"`);
  if (!isRecord(parsed)) {
    throw new BitLiteError(`${componentConfigFileName} for component "${componentId}" must be an object`);
  }
  const kind = parsed.kind === undefined ? "component" : parsed.kind;
  if (kind !== "component" && kind !== "env") {
    throw new BitLiteError(`${componentConfigFileName} kind for component "${componentId}" must be "component" or "env"`);
  }
  return {
    kind,
    dependencies: readDependencyMap(parsed.dependencies, `${componentConfigFileName} dependencies for component "${componentId}"`),
    devDependencies: readDependencyMap(parsed.devDependencies, `${componentConfigFileName} devDependencies for component "${componentId}"`),
    peerDependencies: readDependencyMap(parsed.peerDependencies, `${componentConfigFileName} peerDependencies for component "${componentId}"`),
  };
}

async function findMainFile(rootDir: string, componentId: string, kind: ComponentKind) {
  const candidates = kind === "env" ? ["index.json"] : ordinaryEntryCandidates;
  for (const candidate of candidates) {
    const filePath = path.join(rootDir, candidate);
    try {
      await access(filePath);
      return filePath;
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT")) throw error;
    }
  }
  throw new BitLiteError(
    `component "${componentId}" does not have a supported ${kind} entry file (${candidates.join(", ")})`
  );
}

function readDependencyMap(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new BitLiteError(`${label} must be an object`);
  const result: Record<string, string> = {};
  for (const [name, version] of Object.entries(value)) {
    assertPackageName(name);
    if (typeof version !== "string" || version.length === 0 || /\s/.test(version)) {
      throw new BitLiteError(`${label} dependency "${name}" must have a version string`);
    }
    result[name] = version;
  }
  return sortStringRecord(result);
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

async function assertDirectory(dir: string, message: string) {
  try {
    if (!(await lstat(dir)).isDirectory()) throw new BitLiteError(message);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) throw new BitLiteError(message);
    throw error;
  }
}

function sortStringRecord(record: Record<string, string>) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

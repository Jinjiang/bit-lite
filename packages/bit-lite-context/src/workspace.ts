import { access, lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { assertPackageName, CONFIG_FILE, isWorkspaceProtocolSpec, loadConfig } from "./config.js";
import { loadWorkspaceEnvContexts } from "./env-loader.js";
import { getSelectedEnvKey } from "./env-identity.js";
import type {
  ComponentKind,
  Workspace,
  WorkspaceComponent,
  WorkspaceComponentConfig,
  WorkspaceContext,
  WorkspaceEnvGroup,
} from "./types/index.js";
import { BitLiteError } from "./utils/errors.js";
import { toPosixPath } from "./utils/path-utils.js";
import { matchPattern } from "./utils/patterns.js";

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

/** Read the canonical JSON-safe workspace without resolving any env package. */
export async function readWorkspace(workspaceRoot: string): Promise<Workspace> {
  const rootDir = path.resolve(workspaceRoot);
  const config = await loadConfig(rootDir);
  const configPath = path.join(rootDir, CONFIG_FILE);
  const components: WorkspaceComponent[] = [];
  const byPackageName = new Map<string, WorkspaceComponent>();

  for (const entry of config.components) {
    const componentRoot = resolveInsideWorkspace(rootDir, entry.path, `component "${entry.id}" path`);
    await assertDirectory(componentRoot, `component "${entry.id}" path does not exist: ${entry.path}`);
    const packageConfig = await readComponentPackageConfig(componentRoot, entry.id);
    const mainFile = await findMainFile(componentRoot, entry.id, packageConfig.kind);
    const component: WorkspaceComponent = {
      id: entry.id,
      path: toPosixPath(path.relative(rootDir, componentRoot)),
      rootDir: componentRoot,
      packageName: entry.packageName,
      kind: packageConfig.kind,
      env: entry.env,
      mainFile,
      mainFileRelative: toPosixPath(path.relative(componentRoot, mainFile)),
      dependencies: packageConfig.dependencies,
      devDependencies: packageConfig.devDependencies,
      peerDependencies: packageConfig.peerDependencies,
      internalDependencyPackageNames: [],
      internalEnvPackageName: undefined,
    };
    components.push(component);
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

    validateEnvDependencyVersions(component);
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

  return { rootDir, configPath, config, components };
}

/** Resolve installed env packages while retaining references to canonical workspace components. */
export async function resolveWorkspace(workspace: Workspace): Promise<WorkspaceContext> {
  const envByComponent = await loadWorkspaceEnvContexts(workspace);
  return {
    workspace,
    components: workspace.components.map((component) => {
      const env = envByComponent.get(component.id);
      if (!env) throw new BitLiteError(`env for component "${component.id}" was not loaded`);
      return { component, env };
    }),
  };
}

export function selectWorkspaceComponents(workspace: Workspace, filters: readonly string[]) {
  const selected = filters.length === 0
    ? [...workspace.components]
    : workspace.components.filter((component) => filters.some((filter) => matchPattern(component.id, filter)));
  if (filters.length > 0 && selected.length === 0) {
    throw new BitLiteError(`--filter did not match any components: ${filters.join(", ")}`);
  }
  return selected;
}

export function orderWorkspaceComponents(
  workspace: Workspace,
  components: readonly WorkspaceComponent[] = workspace.components
) {
  const byPackageName = new Map(workspace.components.map((component) => [component.packageName, component]));
  const included = new Set(components.map((component) => component.packageName));
  const ordered: WorkspaceComponent[] = [];
  const permanent = new Set<string>();
  const temporary = new Set<string>();

  const visit = (component: WorkspaceComponent, stack: string[]) => {
    if (permanent.has(component.packageName)) return;
    if (temporary.has(component.packageName)) {
      throw new BitLiteError(
        `component package dependency cycle detected: ${[...stack, component.packageName].join(" -> ")}`
      );
    }
    temporary.add(component.packageName);
    for (const dependencyPackageName of component.internalDependencyPackageNames) {
      if (!included.has(dependencyPackageName)) continue;
      const dependency = byPackageName.get(dependencyPackageName);
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

export function groupWorkspaceComponentsByEnv(
  context: WorkspaceContext,
  selectedComponents: readonly WorkspaceComponent[]
): WorkspaceEnvGroup[] {
  const canonicalById = new Map(context.workspace.components.map((component) => [component.id, component]));
  const selectedIds = new Set<string>();
  for (const component of selectedComponents) {
    const canonical = canonicalById.get(component.id);
    if (canonical !== component) {
      throw new BitLiteError(`selected component "${component.id}" is not the canonical workspace component`);
    }
    if (selectedIds.has(component.id)) throw new BitLiteError("selected components must not contain duplicate ids");
    selectedIds.add(component.id);
  }

  const groups = new Map<string, WorkspaceEnvGroup>();
  for (const componentContext of context.components) {
    if (!selectedIds.has(componentContext.component.id)) continue;
    const key = getSelectedEnvKey(componentContext.env.env);
    const existing = groups.get(key);
    if (existing) {
      (existing.components as WorkspaceComponent[]).push(componentContext.component);
    } else {
      groups.set(key, { env: componentContext.env, components: [componentContext.component] });
    }
  }
  return [...groups.values()].sort((left, right) =>
    getSelectedEnvKey(left.env.env).localeCompare(getSelectedEnvKey(right.env.env))
  );
}

export function getWorkspaceEnvs(context: WorkspaceContext) {
  const envs = new Map<string, WorkspaceContext["components"][number]["env"]>();
  for (const component of context.components) envs.set(getSelectedEnvKey(component.env.env), component.env);
  return [...envs.values()].sort((left, right) =>
    getSelectedEnvKey(left.env).localeCompare(getSelectedEnvKey(right.env))
  );
}

function validateEnvDependencyVersions(component: WorkspaceComponent) {
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

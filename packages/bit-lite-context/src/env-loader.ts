import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateEnvDefinition } from "bit-lite-env";
import type { EnvDefinition, EnvServiceConfig, SupportedEnvServiceName } from "bit-lite-env";
import { isWorkspaceProtocolSpec } from "./config.js";
import type {
  ComponentPackage,
  ComponentPackageRegistry,
  LoadedEnvRuntime,
  LoadedEnvServiceRuntime,
  PackageRef,
} from "./types/index.js";
import { BitLiteError } from "./utils/errors.js";

type PackageManifest = {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  bitLiteGenerated: boolean;
};

type ResolvedEnvPackage = {
  entryPath: string;
  packageRoot: string;
  manifest: PackageManifest;
};

type LoadState = {
  registry: ComponentPackageRegistry;
  cache: Map<string, Promise<LoadedEnvRuntime>>;
};

export async function loadEnvForComponent(
  component: ComponentPackage,
  registry: ComponentPackageRegistry,
  cache = new Map<string, Promise<LoadedEnvRuntime>>()
) {
  const state: LoadState = { registry, cache };
  try {
    const resolved = await resolveSelectedEnv(component, registry);
    return await loadResolvedEnv(component.env, resolved, state, []);
  } catch (error) {
    throw contextualError(error, component.env, [component.id], "load");
  }
}

export async function loadWorkspaceEnvs(registry: ComponentPackageRegistry) {
  const cache = new Map<string, Promise<LoadedEnvRuntime>>();
  const result = new Map<string, LoadedEnvRuntime>();
  const groups = new Map<string, ComponentPackage[]>();
  for (const component of registry.components) {
    const key = `${component.env.packageName}\0${component.env.version}`;
    const group = groups.get(key) ?? [];
    group.push(component);
    groups.set(key, group);
  }
  for (const component of registry.components) {
    const key = `${component.env.packageName}\0${component.env.version}`;
    const affected = groups.get(key) ?? [component];
    try {
      const resolved = await resolveSelectedEnv(component, registry);
      const env = await loadResolvedEnv(component.env, resolved, { registry, cache }, []);
      result.set(component.id, env);
    } catch (error) {
      throw contextualError(error, component.env, affected.map((selected) => selected.id), "load");
    }
  }
  return result;
}

export async function resolveEnvModuleSpecifier(options: {
  specifier: string;
  service: LoadedEnvServiceRuntime;
  workspaceRoot: string;
  field: string;
  selectedEnv: string;
}) {
  const { specifier, service } = options;
  const attempts: string[] = [];
  if (isFileUrl(specifier)) {
    const filePath = fileURLToPath(specifier);
    if (await isFile(filePath)) return filePath;
    attempts.push(filePath);
  } else if (path.isAbsolute(specifier) || specifier.startsWith(".")) {
    const candidate = path.isAbsolute(specifier)
      ? specifier
      : path.resolve(service.entryDirectory, specifier);
    const relative = path.relative(service.packageRoot, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new BitLiteError(
        `${options.field} for selected env "${options.selectedEnv}" declared by "${service.declaredBy}" ` +
        `escapes package root: ${specifier}`
      );
    }
    const resolved = await resolveFileCandidate(candidate);
    if (resolved) return resolved;
    attempts.push(candidate);
  } else {
    for (const manifestPath of [
      path.join(service.packageRoot, "package.json"),
      path.join(options.workspaceRoot, "package.json"),
    ]) {
      try {
        return createRequire(manifestPath).resolve(specifier);
      } catch {
        attempts.push(manifestPath);
      }
    }
  }
  throw new BitLiteError(
    `${options.field} for selected env "${options.selectedEnv}" declared by "${service.declaredBy}" ` +
    `could not resolve "${specifier}"; attempted ${attempts.join(", ")}`
  );
}

export async function resolveVendorSpecifier(options: {
  specifier: string;
  service: LoadedEnvServiceRuntime;
  workspaceRoot: string;
  selectedEnv: string;
  serviceName: string;
}) {
  if (isAbsoluteNonFileUrl(options.specifier)) return options.specifier;
  const resolved = await resolveEnvModuleSpecifier({
    specifier: options.specifier,
    service: options.service,
    workspaceRoot: options.workspaceRoot,
    field: `${options.serviceName} vendor`,
    selectedEnv: options.selectedEnv,
  });
  return pathToFileURL(resolved).href;
}

function isAbsoluteNonFileUrl(value: string) {
  try {
    return new URL(value).protocol !== "file:";
  } catch {
    return false;
  }
}

async function resolveSelectedEnv(component: ComponentPackage, registry: ComponentPackageRegistry) {
  if (isWorkspaceProtocolSpec(component.env.version)) {
    const target = registry.byPackageName.get(component.env.packageName);
    if (!target || target.kind !== "env") {
      throw new BitLiteError(`local env component "${component.env.packageName}" is unavailable`);
    }
    const packageDir = generatedPackageDirectory(registry.workspaceRoot, target.packageName);
    return resolvePackageFromDirectory(packageDir, target.packageName);
  }

  const dependencyProject = componentDependencyDirectory(registry.workspaceRoot, component.packageName);
  const directPackageDirectory = path.join(
    dependencyProject,
    "node_modules",
    ...component.env.packageName.split("/")
  );
  if (!(await isDirectoryOrSymlink(directPackageDirectory))) {
    throw new BitLiteError(
      `external env "${component.env.packageName}@${component.env.version}" is not installed in component ` +
      `development context ${dependencyProject}`
    );
  }
  const resolved = await resolvePackageFromDirectory(directPackageDirectory, component.env.packageName);
  if (resolved.manifest.bitLiteGenerated) {
    throw new BitLiteError(
      `external env "${component.env.packageName}@${component.env.version}" resolved to a generated local Bit component`
    );
  }
  return resolved;
}

async function loadResolvedEnv(
  ref: PackageRef,
  resolved: ResolvedEnvPackage,
  state: LoadState,
  stack: string[]
): Promise<LoadedEnvRuntime> {
  const canonicalEntry = await realpath(resolved.entryPath);
  const cacheKey = `${canonicalEntry}\0${ref.version}`;
  if (stack.includes(canonicalEntry)) {
    const chain = [...stack, canonicalEntry].map((entry) => path.basename(path.dirname(entry))).join(" -> ");
    throw new BitLiteError(`env inheritance cycle detected: ${chain}`);
  }
  const existing = state.cache.get(cacheKey);
  if (existing) return existing;

  const promise = buildLoadedEnv(ref, resolved, canonicalEntry, state, [...stack, canonicalEntry]);
  state.cache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    state.cache.delete(cacheKey);
    throw error;
  }
}

async function buildLoadedEnv(
  ref: PackageRef,
  resolved: ResolvedEnvPackage,
  canonicalEntry: string,
  state: LoadState,
  stack: string[]
): Promise<LoadedEnvRuntime> {
  if (path.extname(canonicalEntry).toLowerCase() !== ".json") {
    throw new BitLiteError(`env package "${ref.packageName}" default entry must be JSON: ${canonicalEntry}`);
  }
  if (resolved.manifest.name !== ref.packageName) {
    throw new BitLiteError(
      `env package identity mismatch: requested "${ref.packageName}" but resolved "${resolved.manifest.name}"`
    );
  }
  if (!isWorkspaceProtocolSpec(ref.version) && !satisfiesVersion(resolved.manifest.version, ref.version)) {
    throw new BitLiteError(
      `env package "${ref.packageName}" installed version "${resolved.manifest.version}" does not satisfy "${ref.version}"`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(canonicalEntry, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BitLiteError(`failed parsing env JSON "${canonicalEntry}": ${message}`);
  }
  const definition = validateEnvDefinition(parsed, resolved.manifest.name);
  const entryDirectory = path.dirname(canonicalEntry);
  let parent: LoadedEnvRuntime | undefined;
  if (definition.extends) {
    const parentVersion = resolved.manifest.dependencies[definition.extends];
    if (!parentVersion) {
      const devOnly = resolved.manifest.devDependencies[definition.extends] !== undefined;
      throw new BitLiteError(
        `env "${definition.name}" extends "${definition.extends}" but it is ` +
        `${devOnly ? "declared only as a development dependency" : "not declared in dependencies"}`
      );
    }
    const parentResolved = await resolvePackageFromContext(definition.extends, resolved.packageRoot);
    parent = await loadResolvedEnv(
      { packageName: definition.extends, version: parentVersion },
      parentResolved,
      state,
      stack
    );
  }

  const ownServices = createServiceOrigins(definition, resolved.packageRoot, canonicalEntry, entryDirectory);
  const services = { ...(parent?.services ?? {}), ...ownServices };
  const effectiveDefinition: EnvDefinition = {
    name: definition.name,
    ...(definition.extends ? { extends: definition.extends } : {}),
    services: Object.fromEntries(
      Object.entries(services).map(([name, runtime]) => [name, runtime.definition])
    ),
    ...((parent?.effectiveDefinition.config || definition.config)
      ? { config: { ...(parent?.effectiveDefinition.config ?? {}), ...(definition.config ?? {}) } }
      : {}),
  };

  return {
    packageName: definition.name,
    requestedVersion: ref.version,
    installedVersion: resolved.manifest.version,
    packageRoot: resolved.packageRoot,
    entryUrl: pathToFileURL(canonicalEntry).href,
    entryDirectory,
    effectiveDefinition,
    services,
    inheritanceChain: [...(parent?.inheritanceChain ?? []), definition.name],
  };
}

function createServiceOrigins(
  definition: EnvDefinition,
  packageRoot: string,
  entryPath: string,
  entryDirectory: string
) {
  const services: Partial<Record<SupportedEnvServiceName, LoadedEnvServiceRuntime>> = {};
  for (const [name, service] of Object.entries(definition.services) as Array<
    [SupportedEnvServiceName, EnvServiceConfig]
  >) {
    services[name] = {
      definition: service,
      declaredBy: definition.name,
      packageRoot,
      entryUrl: pathToFileURL(entryPath).href,
      entryDirectory,
    };
  }
  return services;
}

async function resolvePackageFromContext(packageName: string, contextDir: string) {
  const directPackageDirectory = path.join(contextDir, "node_modules", ...packageName.split("/"));
  if (!(await isDirectoryOrSymlink(directPackageDirectory))) {
    throw new BitLiteError(
      `could not resolve env package "${packageName}" from declared dependency context ${contextDir}; ` +
      `attempted ${directPackageDirectory}`
    );
  }
  return resolvePackageFromDirectory(directPackageDirectory, packageName);
}

async function resolvePackageFromDirectory(packageDir: string, packageName: string) {
  const raw = await readPackageJson(path.join(packageDir, "package.json"));
  const entry = readDefaultExport(raw, packageName);
  return resolvePackageFromEntry(path.resolve(packageDir, entry), packageName);
}

async function resolvePackageFromEntry(entryPath: string, expectedName: string): Promise<ResolvedEnvPackage> {
  const canonicalEntry = await realpath(entryPath);
  let current = path.dirname(canonicalEntry);
  while (true) {
    const manifestPath = path.join(current, "package.json");
    try {
      const raw = await readPackageJson(manifestPath);
      if (raw.name === expectedName) {
        return {
          entryPath: canonicalEntry,
          packageRoot: current,
          manifest: normalizeManifest(raw, manifestPath),
        };
      }
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT")) throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new BitLiteError(`could not locate package manifest for "${expectedName}" from ${entryPath}`);
}

async function readPackageJson(manifestPath: string): Promise<Record<string, unknown>> {
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (!isRecord(raw)) throw new BitLiteError(`package manifest must be an object: ${manifestPath}`);
  return raw;
}

function readDefaultExport(manifest: Record<string, unknown>, packageName: string) {
  const exports = manifest.exports;
  if (typeof exports === "string") return exports;
  if (isRecord(exports)) {
    const root = exports["."];
    if (typeof root === "string") return root;
    if (isRecord(root)) {
      for (const condition of ["default", "import", "require"]) {
        if (typeof root[condition] === "string") return root[condition];
      }
    }
  }
  if (typeof manifest.main === "string") return manifest.main;
  throw new BitLiteError(`env package "${packageName}" does not define a default package export`);
}

function normalizeManifest(raw: Record<string, unknown>, manifestPath: string): PackageManifest {
  if (typeof raw.name !== "string" || typeof raw.version !== "string") {
    throw new BitLiteError(`package manifest must define name and version: ${manifestPath}`);
  }
  return {
    name: raw.name,
    version: raw.version,
    dependencies: readStringRecord(raw.dependencies),
    devDependencies: readStringRecord(raw.devDependencies),
    bitLiteGenerated: isRecord(raw.bitLite) && raw.bitLite.generated === true,
  };
}

function readStringRecord(value: unknown) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function satisfiesVersion(installed: string, requested: string) {
  if (requested.startsWith("workspace:") || requested.startsWith("file:") || requested.startsWith("link:")) return true;
  const installedParts = parseVersion(installed);
  const range = /^(\^|~|>=|>|<=|<)?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(requested);
  if (!installedParts || !range) return requested === installed;
  const requestedParts: [number, number, number] = [Number(range[2]), Number(range[3]), Number(range[4])];
  const comparison = compareVersions(installedParts, requestedParts);
  switch (range[1] ?? "") {
    case "^": return comparison >= 0 && installedParts[0] === requestedParts[0];
    case "~": return comparison >= 0 && installedParts[0] === requestedParts[0] && installedParts[1] === requestedParts[1];
    case ">=": return comparison >= 0;
    case ">": return comparison > 0;
    case "<=": return comparison <= 0;
    case "<": return comparison < 0;
    default: return comparison === 0;
  }
}

function parseVersion(value: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function compareVersions(left: [number, number, number], right: [number, number, number]) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return (left[index] ?? 0) - (right[index] ?? 0);
  }
  return 0;
}

function contextualError(error: unknown, ref: PackageRef, componentIds: string[], phase: string) {
  const message = error instanceof Error ? error.message : String(error);
  return new BitLiteError(
    `failed to ${phase} env "${ref.packageName}@${ref.version}" for components ${componentIds.join(", ")}: ${message}`
  );
}

function componentDependencyDirectory(workspaceRoot: string, packageName: string) {
  return path.join(workspaceRoot, ".bit-lite", "deps", "components", ...packageName.split("/"));
}

function generatedPackageDirectory(workspaceRoot: string, packageName: string) {
  return path.join(workspaceRoot, "node_modules", ...packageName.split("/"));
}

async function resolveFileCandidate(candidate: string) {
  for (const filePath of [candidate, `${candidate}.js`, `${candidate}.mjs`, `${candidate}.cjs`, `${candidate}.json`]) {
    if (await isFile(filePath)) return filePath;
  }
  return undefined;
}

async function isFile(filePath: string) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectoryOrSymlink(filePath: string) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

function isFileUrl(value: string) {
  try {
    return new URL(value).protocol === "file:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

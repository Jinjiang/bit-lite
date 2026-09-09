import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  isCompiledEnvDefinition,
  validateCompiledEnvDefinition,
  validateEnvDefinition,
} from "bit-lite-env";
import {
  BitLiteError,
  formatError,
  isFileUrl,
  isRecord,
  readDefaultExport,
  readStringRecord,
} from "bit-lite-utils";
import { isDirectory, isFile, isNodeErrorCode } from "bit-lite-utils/node";
import type {
  CompiledEnvDefinition,
  EnvDefinition,
  EnvServiceConfigMap,
  SupportedEnvServiceName,
} from "bit-lite-env";
import {
  getComponentDependencyDirectory,
  getLinkedPackageDirectory,
  isWorkspaceProtocolSpec,
} from "bit-lite-context";
import type { PackageRef, Workspace, WorkspaceComponent } from "bit-lite-context";
import { getPackageRefEnvKey } from "./env-identity.js";
import type {
  EnvContext,
  PackageLocation,
  ResolvedService,
  ResolvedServices,
} from "./types.js";

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
  workspace: Workspace;
  cache: Map<string, Promise<EnvContext>>;
};

export async function loadEnvForComponent(
  component: WorkspaceComponent,
  workspace: Workspace,
  cache = new Map<string, Promise<EnvContext>>()
) {
  const state: LoadState = { workspace, cache };
  try {
    const resolved = await resolveSelectedEnv(component, workspace);
    return await loadResolvedEnv(component.env, resolved, state, []);
  } catch (error) {
    throw contextualError(error, component.env, [component.id]);
  }
}

/**
 * Loads every component's env. A failure names every component that selected
 * the same env, because that is who the failure is about — resolution happens
 * per component only because each one resolves through its own dependency
 * project.
 */
export async function loadWorkspaceEnvContexts(workspace: Workspace) {
  const cache = new Map<string, Promise<EnvContext>>();
  const result = new Map<string, EnvContext>();
  const componentIdsByEnv = new Map<string, string[]>();
  for (const component of workspace.components) {
    const key = getPackageRefEnvKey(component.env);
    componentIdsByEnv.set(key, [...(componentIdsByEnv.get(key) ?? []), component.id]);
  }

  for (const component of workspace.components) {
    try {
      const resolved = await resolveSelectedEnv(component, workspace);
      result.set(
        component.id,
        await loadResolvedEnv(component.env, resolved, { workspace, cache }, [])
      );
    } catch (error) {
      const affected = componentIdsByEnv.get(getPackageRefEnvKey(component.env)) ?? [component.id];
      throw contextualError(error, component.env, affected);
    }
  }
  return result;
}

/**
 * Resolves a module named by an env service, using only the serializable
 * service origin and the workspace root — so a vendor worker can resolve the
 * same specifier the parent would.
 */
export async function resolveServiceSpecifier(options: {
  specifier: string;
  source: PackageLocation;
  workspaceRoot: string;
  field: string;
  selectedEnv: string;
}) {
  const { specifier, source } = options;
  const attempts: string[] = [];
  if (isFileUrl(specifier)) {
    const filePath = fileURLToPath(specifier);
    if (await isFile(filePath)) return filePath;
    attempts.push(filePath);
  } else if (path.isAbsolute(specifier) || specifier.startsWith(".")) {
    const candidate = path.isAbsolute(specifier)
      ? specifier
      : path.resolve(path.dirname(source.entryFile), specifier);
    const relative = path.relative(source.rootDir, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new BitLiteError(
        `${options.field} for selected env "${options.selectedEnv}" declared by "${source.identity.packageName}" ` +
        `escapes package root: ${specifier}`
      );
    }
    const resolved = await resolveFileCandidate(candidate);
    if (resolved) return resolved;
    attempts.push(candidate);
  } else {
    for (const manifestPath of [
      path.join(source.rootDir, "package.json"),
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
    `${options.field} for selected env "${options.selectedEnv}" declared by "${source.identity.packageName}" ` +
    `could not resolve "${specifier}"; attempted ${attempts.join(", ")}`
  );
}

export async function resolveVendorSpecifier(options: {
  specifier: string;
  source: PackageLocation;
  workspaceRoot: string;
  selectedEnv: string;
  serviceName: string;
}) {
  if (isAbsoluteNonFileUrl(options.specifier)) return options.specifier;
  const resolved = await resolveServiceSpecifier({
    specifier: options.specifier,
    source: options.source,
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

async function resolveSelectedEnv(component: WorkspaceComponent, workspace: Workspace) {
  if (isWorkspaceProtocolSpec(component.env.version)) {
    const target = workspace.components.find((candidate) => candidate.packageName === component.env.packageName);
    if (!target || target.kind !== "env") {
      throw new BitLiteError(`local env component "${component.env.packageName}" is unavailable`);
    }
    const packageDir = getLinkedPackageDirectory(workspace.rootDir, target.packageName);
    return resolvePackageFromDirectory(packageDir, target.packageName);
  }

  const dependencyProject = getComponentDependencyDirectory(
    workspace.rootDir,
    component.packageName
  );
  const directPackageDirectory = path.join(
    dependencyProject,
    "node_modules",
    ...component.env.packageName.split("/")
  );
  if (!(await isDirectory(directPackageDirectory))) {
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
): Promise<EnvContext> {
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
): Promise<EnvContext> {
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
    throw new BitLiteError(`failed parsing env JSON "${canonicalEntry}": ${formatError(error)}`);
  }
  if (isCompiledEnvDefinition(parsed)) {
    const definition = validateCompiledEnvDefinition(parsed, resolved.manifest.name);
    return buildCompiledEnvContext(ref, resolved, canonicalEntry, definition);
  }
  if (resolved.manifest.bitLiteGenerated) {
    throw new BitLiteError(
      `generated local env "${resolved.manifest.name}" exports an uncompiled source definition; ` +
      `compile it through its configured services.compile vendor`
    );
  }
  const definition = validateEnvDefinition(parsed, resolved.manifest.name);
  let parent: EnvContext | undefined;
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

  const source: PackageLocation = {
    identity: { packageName: definition.name, version: resolved.manifest.version },
    rootDir: resolved.packageRoot,
    entryFile: canonicalEntry,
  };
  const ownServices = createServiceOrigins(definition, source);
  const services: ResolvedServices = { ...(parent?.services ?? {}), ...ownServices };
  const config = parent?.config || definition.config
    ? { ...(parent?.config ?? {}), ...(definition.config ?? {}) }
    : undefined;

  return {
    identity: {
      packageName: definition.name,
      requestedVersion: ref.version,
      installedVersion: resolved.manifest.version,
    },
    package: source,
    config,
    services,
    inheritance: [...(parent?.inheritance ?? []), source.identity],
  };
}

async function buildCompiledEnvContext(
  ref: PackageRef,
  resolved: ResolvedEnvPackage,
  canonicalEntry: string,
  definition: CompiledEnvDefinition
): Promise<EnvContext> {
  const source = toPackageLocation(resolved, canonicalEntry);
  const services: ResolvedServices = {};
  for (const [name, service] of Object.entries(definition.services) as Array<
    [SupportedEnvServiceName, EnvServiceConfigMap[SupportedEnvServiceName]]
  >) {
    const origin = definition.serviceOrigins[name];
    if (!origin) throw new BitLiteError(`compiled env service "${name}" is missing origin metadata`);
    const originPackage = await followDependencyPath(resolved, origin.dependencyPath, name);
    const originEntry = await realpath(originPackage.entryPath);
    (services as Record<string, ResolvedService>)[name] = {
      name,
      definition: service,
      source: toPackageLocation(originPackage, originEntry),
    };
  }

  return {
    identity: {
      packageName: definition.name,
      requestedVersion: ref.version,
      installedVersion: resolved.manifest.version,
    },
    package: source,
    config: definition.config,
    services,
    inheritance: await resolveCompiledInheritance(resolved, definition),
  };
}

async function resolveCompiledInheritance(
  selected: ResolvedEnvPackage,
  definition: CompiledEnvDefinition
) {
  const identities = [{ packageName: selected.manifest.name, version: selected.manifest.version }];
  let current = selected;
  const ancestors = definition.inheritance.slice(0, -1).reverse();
  for (const packageName of ancestors) {
    current = await resolveDeclaredDependency(current, packageName, "inheritance");
    identities.unshift({ packageName: current.manifest.name, version: current.manifest.version });
  }
  return identities;
}

async function followDependencyPath(
  selected: ResolvedEnvPackage,
  dependencyPath: readonly string[],
  serviceName: string
) {
  let current = selected;
  for (const packageName of dependencyPath) {
    current = await resolveDeclaredDependency(current, packageName, `service "${serviceName}" origin`);
  }
  return current;
}

async function resolveDeclaredDependency(
  current: ResolvedEnvPackage,
  packageName: string,
  label: string
) {
  if (current.manifest.dependencies[packageName] === undefined) {
    throw new BitLiteError(
      `compiled env ${label} dependency path cannot follow "${packageName}" from ` +
      `"${current.manifest.name}" because it is not declared in dependencies`
    );
  }
  try {
    return await resolvePackageFromContext(packageName, current.packageRoot);
  } catch (error) {
    throw new BitLiteError(
      `compiled env ${label} dependency path failed at "${current.manifest.name}" -> ` +
      `"${packageName}": ${formatError(error)}`
    );
  }
}

function toPackageLocation(resolved: ResolvedEnvPackage, canonicalEntry: string): PackageLocation {
  return {
    identity: { packageName: resolved.manifest.name, version: resolved.manifest.version },
    rootDir: resolved.packageRoot,
    entryFile: canonicalEntry,
  };
}

function createServiceOrigins(definition: EnvDefinition, source: PackageLocation) {
  const services: ResolvedServices = {};
  for (const [name, service] of Object.entries(definition.services) as Array<
    [SupportedEnvServiceName, EnvServiceConfigMap[SupportedEnvServiceName]]
  >) {
    (services as Record<string, ResolvedService>)[name] = {
      name,
      definition: service,
      source,
    };
  }
  return services;
}

async function resolvePackageFromContext(packageName: string, contextDir: string) {
  const directPackageDirectory = getLinkedPackageDirectory(contextDir, packageName);
  if (!(await isDirectory(directPackageDirectory))) {
    throw new BitLiteError(
      `could not resolve env package "${packageName}" from declared dependency context ${contextDir}; ` +
      `attempted ${directPackageDirectory}`
    );
  }
  return resolvePackageFromDirectory(directPackageDirectory, packageName);
}

async function resolvePackageFromDirectory(packageDir: string, packageName: string) {
  const raw = await readPackageJson(path.join(packageDir, "package.json"));
  const entry = readDefaultExport(raw, `env package "${packageName}"`);
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

function contextualError(error: unknown, ref: PackageRef, componentIds: readonly string[]) {
  return new BitLiteError(
    `failed to load env "${ref.packageName}@${ref.version}" for components ` +
    `${componentIds.join(", ")}: ${formatError(error)}`
  );
}

async function resolveFileCandidate(candidate: string) {
  for (const filePath of [candidate, `${candidate}.js`, `${candidate}.mjs`, `${candidate}.cjs`, `${candidate}.json`]) {
    if (await isFile(filePath)) return filePath;
  }
  return undefined;
}

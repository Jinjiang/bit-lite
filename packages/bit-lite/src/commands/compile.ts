import path from "node:path";
import {
  loadWorkspace,
  resolveVendorSpecifier,
  selectComponentRefs,
  toSelectedEnvIdentity,
} from "bit-lite-context";
import type {
  ComponentPackage,
  ComponentPackageRegistry,
  ComponentRuntime,
  LoadedEnvServiceRuntime,
  ParsedCliArgs,
  SelectedEnvIdentity,
} from "bit-lite-context";
import type { JsonObject } from "bit-lite-env";
import { BitLiteError } from "../utils/errors.js";
import { materializeLocalEnvComponents } from "../env-component-compiler.js";
import {
  getPackageDirectory,
  linkComponentPackages,
  loadComponentPackageRegistry,
} from "./link.js";

export type CompileVendorInput = {
  env: SelectedEnvIdentity;
  component: {
    id: string;
    rootDir: string;
    packageName: string;
  };
  mainFileRelative: string;
  distDir: string;
  config: JsonObject;
};

export type CompileServiceResult = {
  service: "compile";
  componentId: string;
  outputDir: string;
};

type CompilerVendor = {
  meta: {
    id: string;
    label: string;
  };
  compileComponent(input: CompileVendorInput): Promise<unknown>;
};

type CompileFailure = {
  component: ComponentPackage;
  error: Error;
};

export async function runCompileCommand(parsed: ParsedCliArgs) {
  if (parsed.args.positional.length > 0) {
    throw new BitLiteError("bit-lite compile does not accept positional arguments; use --filter");
  }

  const registry = await loadComponentPackageRegistry(parsed.workspaceRoot);
  await linkComponentPackages(registry);
  const selectedIds = selectComponentRefs(
    registry.components,
    parsed.componentFilters
  ).map((component) => component.id);
  const compiled = await compileComponentPackages(registry, selectedIds);
  printCompiledComponents(compiled);
}

export async function compileComponentPackages(
  registry: ComponentPackageRegistry,
  selectedIds?: string[]
) {
  await materializeLocalEnvComponents(registry);
  const workspace = await loadWorkspace(registry.workspaceRoot, { registry });
  const selected = new Set(selectedIds ?? registry.components.map((component) => component.id));
  const ordinary = registry.components.filter(
    (component) => component.kind === "component" && selected.has(component.id)
  );
  const runtimeById = new Map(workspace.components.map((component) => [component.id, component]));
  const layers = createCompileLayers(registry, ordinary);
  const completed: ComponentPackage[] = [];
  const failedPackages = new Set<string>();
  const failures: CompileFailure[] = [];
  const vendorCache = new Map<string, Promise<CompilerVendor>>();

  for (const layer of layers) {
    const runnable = layer.filter((component) => {
      const blockedBy = component.internalDependencyPackageNames.find((name) => failedPackages.has(name));
      if (!blockedBy) return true;
      failedPackages.add(component.packageName);
      failures.push({
        component,
        error: new BitLiteError(`compile skipped because dependency "${blockedBy}" failed`),
      });
      return false;
    });
    const results = await Promise.allSettled(
      runnable.map(async (component) => {
        const runtime = runtimeById.get(component.id);
        if (!runtime) throw new BitLiteError(`component runtime "${component.id}" is unavailable`);
        await compileOrdinaryComponent(registry, component, runtime, vendorCache);
        return component;
      })
    );
    for (const [index, result] of results.entries()) {
      const component = runnable[index];
      if (!component) continue;
      if (result.status === "fulfilled") completed.push(component);
      else {
        failedPackages.add(component.packageName);
        failures.push({ component, error: asError(result.reason) });
      }
    }
  }

  if (failures.length > 0) {
    const details = failures
      .map(({ component, error }) => `- ${component.id} (${component.packageName}): ${error.message}`)
      .join("\n");
    throw new BitLiteError(`Compilation failed for ${failures.length} component package(s):\n${details}`);
  }
  return completed;
}

async function compileOrdinaryComponent(
  registry: ComponentPackageRegistry,
  component: ComponentPackage,
  runtime: ComponentRuntime,
  vendorCache: Map<string, Promise<CompilerVendor>>
) {
  const service = runtime.env.services.compile;
  if (!service) {
    throw new BitLiteError(`selected env "${runtime.env.packageName}" does not define services.compile`);
  }
  const vendorUrl = await resolveVendorSpecifier({
    specifier: service.definition.vendor,
    service,
    workspaceRoot: registry.workspaceRoot,
    selectedEnv: runtime.env.packageName,
    serviceName: "compile",
  });
  const vendor = await loadCompilerVendor(vendorUrl, service, runtime.env.packageName, vendorCache);
  const distDir = path.join(getPackageDirectory(registry.workspaceRoot, component.packageName), "dist");
  const result = await vendor.compileComponent({
    env: toSelectedEnvIdentity(runtime.env),
    component: {
      id: component.id,
      rootDir: component.rootDir,
      packageName: component.packageName,
    },
    mainFileRelative: component.mainFileRelative,
    distDir,
    config: (service.definition.config ?? {}) as JsonObject,
  });
  if (!isCompileServiceResult(result, component.id, distDir)) {
    throw new BitLiteError(
      `compile vendor "${vendor.meta.id}" returned an invalid result for component "${component.id}"`
    );
  }
}

async function loadCompilerVendor(
  vendorUrl: string,
  service: LoadedEnvServiceRuntime,
  selectedEnv: string,
  cache: Map<string, Promise<CompilerVendor>>
) {
  const existing = cache.get(vendorUrl);
  if (existing) return existing;
  const promise = (async () => {
    let module: unknown;
    try {
      module = await import(vendorUrl);
    } catch (error) {
      throw new BitLiteError(
        `failed to import compile vendor for selected env "${selectedEnv}" declared by ` +
        `"${service.declaredBy}" from ${vendorUrl}: ${asError(error).message}`
      );
    }
    if (!isCompilerVendor(module)) {
      throw new BitLiteError(
        `compile vendor for selected env "${selectedEnv}" declared by "${service.declaredBy}" ` +
        `must export meta and compileComponent()`
      );
    }
    return module;
  })();
  cache.set(vendorUrl, promise);
  return promise;
}

function createCompileLayers(registry: ComponentPackageRegistry, components: ComponentPackage[]) {
  const included = new Set(components.map((component) => component.packageName));
  const remaining = new Map(components.map((component) => [component.packageName, component]));
  const completed = new Set<string>();
  const layers: ComponentPackage[][] = [];
  while (remaining.size > 0) {
    const layer = [...remaining.values()]
      .filter((component) => component.internalDependencyPackageNames.every(
        (dependency) => !included.has(dependency) || completed.has(dependency)
      ))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (layer.length === 0) {
      throw new BitLiteError(`component package dependency cycle prevents compile in ${registry.workspaceRoot}`);
    }
    layers.push(layer);
    for (const component of layer) {
      remaining.delete(component.packageName);
      completed.add(component.packageName);
    }
  }
  return layers;
}

function isCompilerVendor(value: unknown): value is CompilerVendor {
  return isRecord(value) && isRecord(value.meta) &&
    typeof value.meta.id === "string" && typeof value.meta.label === "string" &&
    typeof value.compileComponent === "function";
}

function isCompileServiceResult(value: unknown, componentId: string, outputDir: string) {
  return isRecord(value) && value.service === "compile" && value.componentId === componentId &&
    typeof value.outputDir === "string" && path.resolve(value.outputDir) === path.resolve(outputDir);
}

function printCompiledComponents(components: ComponentPackage[]) {
  console.log(`Compiled ${components.length} component package${components.length === 1 ? "" : "s"}.`);
  for (const component of components) console.log(`- ${component.packageName}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

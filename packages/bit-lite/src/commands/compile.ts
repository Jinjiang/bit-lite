import path from "node:path";
import {
  readWorkspace,
  resolveVendorSpecifier,
  resolveWorkspace,
  selectWorkspaceComponents,
} from "bit-lite-context";
import { createVendorContext } from "bit-lite-vendors";
import type {
  CliArguments,
  ComponentContext,
  ParsedCliArgs,
  Workspace,
  WorkspaceComponent,
} from "bit-lite-context";
import type {
  JsonObject,
  JsonValue,
  VendorData,
  VendorDefinition,
} from "bit-lite-vendors";
import { BitLiteError } from "../utils/errors.js";
import { materializeLocalEnvComponents } from "../env-component-compiler.js";
import { getPackageDirectory, linkComponentPackages } from "./link.js";

export type CompileVendorRuntime = JsonObject & {
  mainFileRelative: string;
  distDir: string;
};

export type CompileVendorInput = VendorData<JsonObject, CompileVendorRuntime>;

type CompilerVendor = {
  meta: VendorDefinition;
  compileComponent(input: CompileVendorInput): Promise<unknown>;
};

type CompileFailure = {
  component: WorkspaceComponent;
  error: Error;
};

export async function runCompileCommand(parsed: ParsedCliArgs) {
  if (parsed.args.positional.length > 0) {
    throw new BitLiteError("bit-lite compile does not accept positional arguments; use --filter");
  }

  const workspace = await readWorkspace(parsed.workspaceRoot);
  await linkComponentPackages(workspace);
  const selectedIds = selectWorkspaceComponents(workspace, parsed.componentFilters)
    .map((component) => component.id);
  const compiled = await compileComponentPackages(workspace, selectedIds, parsed.args);
  printCompiledComponents(compiled);
}

export async function compileComponentPackages(
  workspace: Workspace,
  selectedIds?: string[],
  args: CliArguments = { raw: [], positional: [], options: {}, passthrough: [] }
) {
  await materializeLocalEnvComponents(workspace);
  const context = await resolveWorkspace(workspace);
  const selected = new Set(selectedIds ?? workspace.components.map((component) => component.id));
  const ordinary = workspace.components.filter(
    (component) => component.kind === "component" && selected.has(component.id)
  );
  const contextById = new Map(context.components.map((component) => [component.component.id, component]));
  const layers = createCompileLayers(workspace, ordinary);
  const completed: WorkspaceComponent[] = [];
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
        const componentContext = contextById.get(component.id);
        if (!componentContext) throw new BitLiteError(`component context "${component.id}" is unavailable`);
        await compileOrdinaryComponent(workspace, component, componentContext, args, vendorCache);
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
  workspace: Workspace,
  component: WorkspaceComponent,
  componentContext: ComponentContext,
  args: CliArguments,
  vendorCache: Map<string, Promise<CompilerVendor>>
) {
  const service = componentContext.env.services.compile;
  if (!service) {
    throw new BitLiteError(`selected env "${componentContext.env.env.packageName}" does not define services.compile`);
  }
  const vendorUrl = await resolveVendorSpecifier({
    specifier: service.definition.vendor,
    service,
    workspaceRoot: workspace.rootDir,
    selectedEnv: componentContext.env.env.packageName,
    serviceName: "compile",
  });
  const vendor = await loadCompilerVendor(
    vendorUrl,
    componentContext.env.env.packageName,
    service.source.identity.packageName,
    vendorCache
  );
  const distDir = path.join(getPackageDirectory(workspace.rootDir, component.packageName), "dist");
  const result = await vendor.compileComponent({
    context: createVendorContext({ workspace, args, env: componentContext.env, service }),
    components: [component],
    config: service.definition.config ?? {},
    runtime: {
      mainFileRelative: component.mainFileRelative,
      distDir,
    },
  });
  if (!isCompileProducedResult(result)) {
    throw new BitLiteError(
      `compile vendor "${vendor.meta.id}" returned an invalid result for component "${component.id}"`
    );
  }
}

async function loadCompilerVendor(
  vendorUrl: string,
  selectedEnv: string,
  declaredBy: string,
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
        `"${declaredBy}" from ${vendorUrl}: ${asError(error).message}`
      );
    }
    if (!isCompilerVendor(module)) {
      throw new BitLiteError(
        `compile vendor for selected env "${selectedEnv}" declared by "${declaredBy}" ` +
        `must export meta: VendorDefinition and compileComponent()`
      );
    }
    return module;
  })();
  cache.set(vendorUrl, promise);
  return promise;
}

function createCompileLayers(workspace: Workspace, components: WorkspaceComponent[]) {
  const included = new Set(components.map((component) => component.packageName));
  const remaining = new Map(components.map((component) => [component.packageName, component]));
  const completed = new Set<string>();
  const layers: WorkspaceComponent[][] = [];
  while (remaining.size > 0) {
    const layer = [...remaining.values()]
      .filter((component) => component.internalDependencyPackageNames.every(
        (dependency) => !included.has(dependency) || completed.has(dependency)
      ))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (layer.length === 0) {
      throw new BitLiteError(`component package dependency cycle prevents compile in ${workspace.rootDir}`);
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
  return isRecord(value) && isVendorDefinition(value.meta) && typeof value.compileComponent === "function";
}

function isVendorDefinition(value: unknown): value is VendorDefinition {
  return isRecord(value) && typeof value.id === "string" && typeof value.label === "string" &&
    typeof value.hint === "string" && (typeof value.moduleUrl === "string" || value.moduleUrl instanceof URL);
}

export function isCompileProducedResult(value: unknown) {
  return value === undefined || isJsonObject(value);
}

function printCompiledComponents(components: WorkspaceComponent[]) {
  console.log(`Compiled ${components.length} component package${components.length === 1 ? "" : "s"}.`);
  for (const component of components) console.log(`- ${component.packageName}`);
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

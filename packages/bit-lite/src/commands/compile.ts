import path from "node:path";
import {
  loadEnvForComponent,
  readWorkspace,
  resolveVendorSpecifier,
  selectWorkspaceComponents,
} from "bit-lite-context";
import {
  isCompilerVendorModule,
  isCompileRunResult,
  isCompileWatchResult,
} from "bit-lite-compiler";
import type {
  CompileRunResult,
  CompileVendorInput,
  CompileWatchResult,
} from "bit-lite-compiler";
import {
  createWatchVendorTasks,
  createVendorContext,
  runVendorTasks,
  stopVendorTasks,
  superviseVendorTasks,
} from "bit-lite-vendors";
import type {
  CliArguments,
  EnvContext,
  ParsedCliArgs,
  Workspace,
  WorkspaceComponent,
} from "bit-lite-context";
import type {
  VendorTask,
  VendorTaskStartOptions,
} from "bit-lite-vendors";
import { BitLiteError } from "../utils/errors.js";
import { getPackageDirectory, linkComponentPackages } from "./link.js";
import type { WatchCommandContribution } from "./watch-contribution.js";

export { isCompileRunResult } from "bit-lite-compiler";
export type { CompileVendorInput, CompileVendorRuntime } from "bit-lite-compiler";

type CompileFailure = {
  component: WorkspaceComponent;
  error: Error;
};

type CompilePreparation = {
  env: EnvContext;
  vendorUrl: string;
  input: CompileVendorInput;
};

export type CompilePlan = {
  components: readonly WorkspaceComponent[];
  layers: readonly (readonly WorkspaceComponent[])[];
};

export type CompileWatchTaskBinding = {
  task: VendorTask<unknown, CompileWatchResult>;
  component: WorkspaceComponent;
};

export type CompileWatchContribution = WatchCommandContribution<
  VendorTask<unknown, CompileWatchResult>
> & {
  plan: CompilePlan;
  bindings: CompileWatchTaskBinding[];
  effectiveArgs: CliArguments;
};

export async function runCompileCommand(parsed: ParsedCliArgs) {
  const workspace = await readWorkspace(parsed.workspaceRoot);
  await linkComponentPackages(workspace);
  const selectedIds = selectWorkspaceComponents(workspace, parsed.componentFilters)
    .map((component) => component.id);
  if (parsed.args.options.watch === true) {
    const contribution = await createCompileWatchContribution(
      workspace,
      selectedIds,
      parsed.args
    );
    if (contribution.tasks.length === 0) {
      console.log("No compile tasks found.");
      await contribution.dispose();
      return;
    }
    try {
      await superviseVendorTasks(contribution.tasks, {
        title: "bit-lite compile --watch",
        formatStoppingMessage: (reason) => `Stopping bit-lite compile (${reason})...\n`,
        onTasksStarted() {
          return contribution.dispose;
        },
      });
    } finally {
      await contribution.dispose();
    }
    return;
  }
  const compiled = await compileComponentPackages(workspace, selectedIds, parsed.args);
  printCompiledComponents(compiled);
}

export async function createCompileWatchContribution(
  workspace: Workspace,
  selectedIds: readonly string[] | undefined,
  args: CliArguments
): Promise<CompileWatchContribution> {
  const effectiveArgs = createCompileWatchArguments(args);
  const plan = createCompilePlan(workspace, selectedIds);
  const tasks: VendorTask<unknown, CompileWatchResult>[] = [];
  const bindings: CompileWatchTaskBinding[] = [];
  const envCache = new Map<string, Promise<EnvContext>>();
  let disposed = false;

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await stopVendorTasks(tasks);
  };

  try {
    for (const layer of plan.layers) {
      const started = await Promise.allSettled(layer.map(async (component) => {
        const taskOptions = await prepareCompileVendorTaskOptions(
          workspace,
          component,
          effectiveArgs,
          envCache
        );
        await validateCompileWatchVendor(taskOptions.vendorUrl, taskOptions.context.env.packageName);
        let resolveFirstResult!: () => void;
        const firstResult = new Promise<void>((resolve) => {
          resolveFirstResult = resolve;
        });
        const [task] = await createWatchVendorTasks<CompileWatchResult>([{
          ...taskOptions,
          taskId: `compile:${component.id}`,
          taskLabel: `Compile: ${component.id}`,
        }], {
          serviceId: "compile",
          label: "Compile",
          formatResult: formatCompileWatchResult,
          onResult() {
            resolveFirstResult();
          },
        });
        if (!task) throw new BitLiteError(`compile watch task was not created for "${component.id}"`);
        void task.result.catch(() => undefined);
        tasks.push(task);
        bindings.push({ task, component });
        await Promise.race([
          firstResult,
          task.result.then(() => undefined),
        ]);
      }));
      const failure = started.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) throw failure.reason;
    }
  } catch (error) {
    await dispose();
    throw error;
  }

  return {
    serviceId: "compile",
    tasks,
    routes: [],
    plan,
    bindings,
    effectiveArgs,
    dispose,
  };
}

export function createCompileWatchArguments(args: CliArguments): CliArguments {
  return {
    raw: [...args.raw],
    options: { ...args.options, watch: true },
    passthrough: [...args.passthrough],
  };
}

async function validateCompileWatchVendor(vendorUrl: string, selectedEnv: string) {
  const module = await import(vendorUrl) as unknown;
  if (!isCompilerVendorModule(module)) {
    throw new BitLiteError(
      `compile watch vendor for selected env "${selectedEnv}" must export meta and a default CompilerVendorStart`
    );
  }
}

function formatCompileWatchResult(value: unknown) {
  if (!isCompileWatchResult(value)) return new Error("Invalid compile watch result");
  return [
    `run ${value.run}`,
    ...(value.output === null ? [] : [JSON.stringify(value.output)]),
  ];
}

export async function compileComponentPackages(
  workspace: Workspace,
  selectedIds?: string[],
  args: CliArguments = { raw: [], options: {}, passthrough: [] }
) {
  const plan = createCompilePlan(workspace, selectedIds);
  const completed: WorkspaceComponent[] = [];
  const failedPackages = new Set<string>();
  const failures: CompileFailure[] = [];
  const envCache = new Map<string, Promise<EnvContext>>();
  const effectiveArgs = createCompileRunArguments(args);

  for (const layer of plan.layers) {
    const runnable = layer.filter((component) => {
      const blockedBy = compilePrerequisitePackageNames(component)
        .find((name) => failedPackages.has(name));
      if (!blockedBy) return true;
      failedPackages.add(component.packageName);
      failures.push({
        component,
        error: new BitLiteError(`compile skipped because prerequisite "${blockedBy}" failed`),
      });
      return false;
    });
    const results = await Promise.allSettled(
      runnable.map(async (component) => {
        const taskOptions = await prepareCompileVendorTaskOptions(
          workspace,
          component,
          effectiveArgs,
          envCache
        );
        await runVendorTasks<CompileRunResult>([taskOptions], {
          serviceId: "compile",
          label: "Compile",
          formatResult(value) {
            return isCompileRunResult(value)
              ? value
              : new BitLiteError(`compile vendor returned an invalid result for component "${component.id}"`);
          },
          printResults() {},
        });
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

function createCompileRunArguments(args: CliArguments): CliArguments {
  return {
    raw: [...args.raw],
    options: { ...args.options, watch: false },
    passthrough: [...args.passthrough],
  };
}

export function createCompilePlan(workspace: Workspace, selectedIds?: readonly string[]): CompilePlan {
  const requested = selectedIds === undefined
    ? [...workspace.components]
    : selectedIds.map((id) => {
        const component = workspace.components.find((candidate) => candidate.id === id);
        if (!component) throw new BitLiteError(`selected component "${id}" is unavailable`);
        return component;
      });
  const included = new Map(requested.map((component) => [component.packageName, component]));

  for (const component of [...requested]) includeLocalEnvPrerequisites(component);
  const components = [...included.values()];
  return { components, layers: createCompileLayers(workspace, components) };

  function includeLocalEnvPrerequisites(component: WorkspaceComponent) {
    const packageName = component.internalEnvPackageName;
    if (!packageName || included.has(packageName)) return;
    const envComponent = workspace.components.find((candidate) => candidate.packageName === packageName);
    if (!envComponent) throw new BitLiteError(`local env prerequisite "${packageName}" is unavailable`);
    included.set(packageName, envComponent);
    includeLocalEnvPrerequisites(envComponent);
  }
}

export async function prepareCompileVendorTaskOptions(
  workspace: Workspace,
  component: WorkspaceComponent,
  args: CliArguments,
  envCache = new Map<string, Promise<EnvContext>>()
): Promise<VendorTaskStartOptions> {
  const prepared = await prepareComponentCompiler(workspace, component, args, envCache);
  return {
    vendorUrl: prepared.vendorUrl,
    context: prepared.input.context,
    components: prepared.input.components,
    config: prepared.input.config,
    ...(prepared.input.runtime ? { runtime: prepared.input.runtime } : {}),
  };
}

async function prepareComponentCompiler(
  workspace: Workspace,
  component: WorkspaceComponent,
  args: CliArguments,
  envCache: Map<string, Promise<EnvContext>>
): Promise<CompilePreparation> {
  const env = await loadEnvForComponent(component, workspace, envCache);
  const service = env.services.compile;
  if (!service) {
    throw new BitLiteError(`selected env "${env.env.packageName}" does not define services.compile`);
  }
  const vendorUrl = await resolveVendorSpecifier({
    specifier: service.definition.vendor,
    service,
    workspaceRoot: workspace.rootDir,
    selectedEnv: env.env.packageName,
    serviceName: "compile",
  });
  const distDir = path.join(getPackageDirectory(workspace.rootDir, component.packageName), "dist");
  return {
    env,
    vendorUrl,
    input: {
      context: createVendorContext({ workspace, args, env, service }),
      components: [component],
      config: service.definition.config ?? {},
      runtime: {
        mainFileRelative: component.mainFileRelative,
        distDir,
      },
    },
  };
}

function createCompileLayers(workspace: Workspace, components: WorkspaceComponent[]) {
  const included = new Set(components.map((component) => component.packageName));
  const remaining = new Map(components.map((component) => [component.packageName, component]));
  const completed = new Set<string>();
  const layers: WorkspaceComponent[][] = [];
  while (remaining.size > 0) {
    const layer = [...remaining.values()]
      .filter((component) => compilePrerequisitePackageNames(component).every(
        (dependency) => !included.has(dependency) || completed.has(dependency)
      ))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (layer.length === 0) {
      throw new BitLiteError(`component package or environment dependency cycle prevents compile in ${workspace.rootDir}`);
    }
    layers.push(layer);
    for (const component of layer) {
      remaining.delete(component.packageName);
      completed.add(component.packageName);
    }
  }
  return layers;
}

function compilePrerequisitePackageNames(component: WorkspaceComponent) {
  return [
    ...component.internalDependencyPackageNames,
    ...(component.internalEnvPackageName ? [component.internalEnvPackageName] : []),
  ];
}

function printCompiledComponents(components: WorkspaceComponent[]) {
  console.log(`Compiled ${components.length} component package${components.length === 1 ? "" : "s"}.`);
  for (const component of components) console.log(`- ${component.packageName}`);
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

import path from "node:path";
import {
  getComponentPrerequisitePackageNames,
  layerComponentsByPrerequisites,
  loadEnvForComponent,
  readWorkspace,
  selectWorkspaceComponents,
} from "bit-lite-context";
import {
  isCompilerVendorModule,
  isCompileRunResult,
  isCompileWatchResult,
} from "bit-lite-compiler";
import type {
  CompileRunResult,
  CompileWatchResult,
} from "bit-lite-compiler";
import { superviseVendorTasks } from "bit-lite-vendors";
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
import {
  createVendorWatchExecution,
  defineVendorExecution,
  getResolvedService,
  prepareResolvedServiceTaskOptions,
  runVendorExecutionPlan,
} from "../utils/vendor-execution.js";
import type {
  ImmutableCliArguments,
  VendorExecutionPlan,
} from "../utils/vendor-execution.js";
import type { ResolvedCommandSelection } from "../utils/command-selection.js";
import { getPackageDirectory, linkComponentPackages } from "./link.js";
import type { WatchCommandContribution } from "../utils/watch-contribution.js";

export { isCompileRunResult } from "bit-lite-compiler";
export type { CompileVendorInput, CompileVendorRuntime } from "bit-lite-compiler";

type CompileFailure = {
  component: WorkspaceComponent;
  error: Error;
};

export type CompilePlan = VendorExecutionPlan<WorkspaceComponent> & {
  components: readonly WorkspaceComponent[];
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
  effectiveArgs: ImmutableCliArguments;
  ready(): Promise<void>;
};

type CompileExecutionContext = {
  workspace: Workspace;
  envCache: Map<string, Promise<EnvContext>>;
};

const compileVendorExecution = defineVendorExecution<
  WorkspaceComponent,
  CompileExecutionContext,
  undefined,
  CompileRunResult,
  CompileWatchResult
>({
  serviceId: "compile",
  label: "Compile",
  async prepare({ unit, args, mode, context }) {
    const taskOptions = await prepareCompileVendorTaskOptions(
      context.workspace,
      unit.value,
      args,
      context.envCache
    );
    if (mode === "watch") {
      await validateCompileWatchVendor(
        taskOptions.vendorUrl,
        taskOptions.context.env.packageName
      );
    }
    return { taskOptions };
  },
  run: {
    formatResult(value, unit) {
      return isCompileRunResult(value)
        ? value
        : new BitLiteError(
            `compile vendor returned an invalid result for component "${unit.value.id}"`
          );
    },
  },
  watch: {
    activation: "eager",
    formatResult: formatCompileWatchResult,
  },
});

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
        dispose: contribution.dispose,
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
  const plan = createCompilePlan(workspace, selectedIds);
  const execution = await createVendorWatchExecution({
    plan,
    definition: compileVendorExecution,
    context: { workspace, envCache: new Map() },
    args,
  });
  const bindings = execution.preparedUnits.map(({ unit, task }) => ({
    task,
    component: unit.value,
  }));
  let readinessPromise: Promise<void> | undefined;

  return {
    serviceId: "compile",
    tasks: execution.tasks,
    routes: [],
    plan,
    bindings,
    effectiveArgs: execution.args,
    ready() {
      if (readinessPromise) return readinessPromise;
      readinessPromise = Promise.all(
        execution.preparedUnits.map(({ unit }) => execution.ensureUnitReady(unit.id))
      ).then(
        () => undefined,
        async (error) => {
          try {
            await execution.dispose();
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Compile watch readiness and cleanup failed"
            );
          }
          throw error;
        }
      );
      return readinessPromise;
    },
    dispose: execution.dispose,
  };
}

export function selectCompileRootIds(
  selection: Pick<ResolvedCommandSelection, "groups">
): string[] {
  return selection.groups.flatMap((group) =>
    group.env.services.compile
      ? group.components.map((component) => component.id)
      : []
  );
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
  const failures: CompileFailure[] = [];
  const execution = await runVendorExecutionPlan({
    plan,
    definition: compileVendorExecution,
    context: { workspace, envCache: new Map() },
    args,
  });
  const unitById = new Map(
    plan.layers.flat().map((unit) => [unit.id, unit])
  );

  for (const outcome of execution.outcomes) {
    if (outcome.status === "successful") {
      completed.push(outcome.unit.value);
      continue;
    }
    if (outcome.status === "failed") {
      failures.push({ component: outcome.unit.value, error: outcome.error });
      continue;
    }
    const blockedBy = outcome.blockedBy[0];
    const prerequisite = blockedBy ? unitById.get(blockedBy)?.value.packageName : undefined;
    failures.push({
      component: outcome.unit.value,
      error: new BitLiteError(
        `compile skipped because prerequisite "${prerequisite ?? blockedBy ?? "unknown"}" failed`
      ),
    });
  }

  if (failures.length > 0) {
    const details = failures
      .map(({ component, error }) => `- ${component.id} (${component.packageName}): ${error.message}`)
      .join("\n");
    throw new BitLiteError(`Compilation failed for ${failures.length} component package(s):\n${details}`);
  }
  return completed;
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
  const componentByPackage = new Map(
    components.map((component) => [component.packageName, component])
  );
  const componentLayers = layerComponentsByPrerequisites(workspace, components);
  const layers = (componentLayers.length === 0 ? [[]] : componentLayers).map((layer) =>
    layer.map((component) => ({
      id: compileUnitId(component),
      dependsOn: getComponentPrerequisitePackageNames(component).flatMap((packageName) => {
        const prerequisite = componentByPackage.get(packageName);
        return prerequisite ? [compileUnitId(prerequisite)] : [];
      }),
      value: component,
    }))
  );
  return { components, layers };

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
  args: ImmutableCliArguments,
  envCache = new Map<string, Promise<EnvContext>>()
): Promise<VendorTaskStartOptions> {
  const env = await loadEnvForComponent(component, workspace, envCache);
  const service = getResolvedService(env, "compile");
  if (!service) {
    throw new BitLiteError(
      `compile component "${component.id}" selected env "${env.env.packageName}" ` +
      "does not define services.compile"
    );
  }
  const distDir = path.join(getPackageDirectory(workspace.rootDir, component.packageName), "dist");
  return prepareResolvedServiceTaskOptions({
    workspace,
    args,
    unit: {
      group: { env, components: [component] },
      service,
    },
    runtime: {
      mainFileRelative: component.mainFileRelative,
      distDir,
    },
    taskId: compileUnitId(component),
    taskLabel: `Compile: ${component.id}`,
  });
}

function compileUnitId(component: WorkspaceComponent) {
  return `compile:${component.id}`;
}

function printCompiledComponents(components: WorkspaceComponent[]) {
  console.log(`Compiled ${components.length} component package${components.length === 1 ? "" : "s"}.`);
  for (const component of components) console.log(`- ${component.packageName}`);
}

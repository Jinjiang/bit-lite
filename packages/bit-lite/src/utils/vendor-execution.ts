import {
  getSelectedEnvKey,
  resolveVendorSpecifier,
} from "bit-lite-context";
import {
  createVendorContext,
  createWatchVendorTasks,
  runVendorTasks,
  stopVendorTasks,
} from "bit-lite-vendors";
import type {
  CliArguments,
  CliOptionValue,
  EnvContext,
  PackageLocation,
  Workspace,
  WorkspaceComponent,
  WorkspaceEnvGroup,
} from "bit-lite-context";
import type {
  JsonObject,
  JsonValue,
  VendorTaskRunResult,
  VendorTaskStartOptions,
  VendorTask,
  VendorWatchTask,
} from "bit-lite-vendors";
import type { WorkerRunnerOptions } from "bit-lite-vendors";
import type { ResolvedCommandSelection } from "./command-selection.js";

export type PlannedUnit<Unit> = {
  id: string;
  dependsOn: readonly string[];
  value: Unit;
};

export type VendorExecutionPlan<Unit> = {
  layers: readonly (readonly PlannedUnit<Unit>[])[];
};

export type OpenResolvedService = {
  name: string;
  definition: {
    vendor: string;
    config?: JsonObject | undefined;
  };
  source: PackageLocation;
};

export type PlannedEnvServiceUnit = {
  group: WorkspaceEnvGroup;
  service: OpenResolvedService;
};

export type VendorExecutionMode = "run" | "watch";

export type ImmutableCliArguments = {
  readonly raw: readonly string[];
  readonly options: Readonly<Record<string, CliOptionValue>>;
  readonly passthrough: readonly string[];
};

export type PreparedVendorUnit<Prepared = undefined> = {
  taskOptions: VendorTaskStartOptions;
  metadata?: Prepared | undefined;
};

export type VendorExecutionDefinition<
  Unit,
  Context,
  Prepared = undefined,
  RunResult = never,
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
> = {
  serviceId: string;
  label: string;
  prepare(options: {
    unit: PlannedUnit<Unit>;
    args: ImmutableCliArguments;
    mode: VendorExecutionMode;
    context: Context;
  }): PreparedVendorUnit<Prepared> | Promise<PreparedVendorUnit<Prepared>>;
  cleanupPrepared?(
    prepared: PreparedVendorUnit<Prepared>,
    unit: PlannedUnit<Unit>
  ): void | Promise<void>;
  run?: {
    formatResult(result: unknown, unit: PlannedUnit<Unit>): RunResult | Error;
  } | undefined;
  watch?: {
    formatResult(result: unknown, unit: PlannedUnit<Unit>): string[] | Error;
    finalizePreparedLayer?(
      items: readonly {
        unit: PlannedUnit<Unit>;
        prepared: PreparedVendorUnit<Prepared>;
      }[],
      context: Context,
      args: ImmutableCliArguments
    ): void | Promise<void>;
    onResult?(
      result: EventResult,
      task: VendorWatchTask<EventResult, InputMessage>,
      unit: PlannedUnit<Unit>,
      context: Context
    ): void;
    activation: "eager" | "deferred";
    worker?: WorkerRunnerOptions | undefined;
  } | undefined;
};

export type VendorRunOutcome<
  Unit,
  Prepared,
  RunResult,
  InputMessage extends JsonValue = JsonValue,
> =
  | {
      status: "successful";
      unit: PlannedUnit<Unit>;
      prepared: PreparedVendorUnit<Prepared>;
      result: VendorTaskRunResult<RunResult>;
      task: VendorTask<RunResult, JsonValue, InputMessage>;
    }
  | {
      status: "failed";
      unit: PlannedUnit<Unit>;
      error: Error;
    }
  | {
      status: "blocked";
      unit: PlannedUnit<Unit>;
      blockedBy: string[];
    };

export type VendorRunExecution<
  Unit,
  Prepared,
  RunResult,
  InputMessage extends JsonValue = JsonValue,
> = {
  plan: VendorExecutionPlan<Unit>;
  args: ImmutableCliArguments;
  outcomes: VendorRunOutcome<Unit, Prepared, RunResult, InputMessage>[];
};

export type PreparedVendorWatchUnit<
  Unit,
  Prepared,
  EventResult extends JsonValue,
  InputMessage extends JsonValue,
> = {
  unit: PlannedUnit<Unit>;
  prepared: PreparedVendorUnit<Prepared>;
  task: VendorWatchTask<EventResult, InputMessage>;
};

export type ReadyVendorWatchUnit<
  Unit,
  Prepared,
  EventResult extends JsonValue,
  InputMessage extends JsonValue,
> = PreparedVendorWatchUnit<Unit, Prepared, EventResult, InputMessage> & {
  result: EventResult;
};

export type VendorWatchPreparationFailure<Unit> = {
  unit: PlannedUnit<Unit>;
  error: Error;
};

export type VendorWatchExecution<
  Unit,
  Prepared,
  EventResult extends JsonValue,
  InputMessage extends JsonValue,
> = {
  plan: VendorExecutionPlan<Unit>;
  args: ImmutableCliArguments;
  preparedUnits: PreparedVendorWatchUnit<Unit, Prepared, EventResult, InputMessage>[];
  preparationFailures: VendorWatchPreparationFailure<Unit>[];
  tasks: VendorWatchTask<EventResult, InputMessage>[];
  ensureUnitReady(
    unitId: string
  ): Promise<ReadyVendorWatchUnit<Unit, Prepared, EventResult, InputMessage>>;
  dispose(): Promise<void>;
};

export function validateVendorExecutionPlan<Unit>(
  plan: VendorExecutionPlan<Unit>
): VendorExecutionPlan<Unit> {
  if (plan.layers.length === 0) {
    throw new Error("Vendor execution plan must contain at least one layer");
  }

  const layerById = new Map<string, number>();
  for (const [layerIndex, layer] of plan.layers.entries()) {
    for (const unit of layer) {
      if (unit.id.length === 0) {
        throw new Error("Vendor execution plan unit IDs must be non-empty");
      }
      if (layerById.has(unit.id)) {
        throw new Error(`Vendor execution plan contains duplicate unit ID "${unit.id}"`);
      }
      layerById.set(unit.id, layerIndex);
    }
  }

  for (const [layerIndex, layer] of plan.layers.entries()) {
    for (const unit of layer) {
      for (const dependencyId of unit.dependsOn) {
        const dependencyLayer = layerById.get(dependencyId);
        if (dependencyLayer === undefined) {
          throw new Error(
            `Vendor execution plan unit "${unit.id}" depends on missing unit "${dependencyId}"`
          );
        }
        if (dependencyLayer >= layerIndex) {
          throw new Error(
            `Vendor execution plan unit "${unit.id}" dependency "${dependencyId}" ` +
            "must be in an earlier layer"
          );
        }
      }
    }
  }

  return plan;
}

export function getResolvedService(
  env: EnvContext,
  serviceId: string
): OpenResolvedService | undefined {
  assertServiceId(serviceId);
  return (env.services as unknown as Record<string, OpenResolvedService | undefined>)[serviceId];
}

export function createEnvServiceExecutionPlan(
  selection: ResolvedCommandSelection,
  serviceId: string
): VendorExecutionPlan<PlannedEnvServiceUnit> {
  assertServiceId(serviceId);
  const units = selection.groups.flatMap((group) => {
    const service = getResolvedService(group.env, serviceId);
    return service
      ? [{
          id: `${serviceId}:${getSelectedEnvKey(group.env.env)}`,
          dependsOn: [],
          value: { group, service },
        }]
      : [];
  });
  units.sort((left, right) => left.id.localeCompare(right.id));
  return { layers: [units] };
}

export function defineVendorExecution<
  Unit,
  Context,
  Prepared = undefined,
  RunResult = never,
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
>(
  definition: VendorExecutionDefinition<
    Unit,
    Context,
    Prepared,
    RunResult,
    EventResult,
    InputMessage
  >
) {
  assertServiceId(definition.serviceId);
  if (!definition.run && !definition.watch) {
    throw new Error(
      `Vendor execution definition "${definition.serviceId}" must support run or watch execution`
    );
  }
  return definition;
}

export function createEffectiveVendorArguments(
  args: CliArguments,
  mode: VendorExecutionMode
): ImmutableCliArguments {
  const raw = Object.freeze([...args.raw]);
  const options = Object.freeze({ ...args.options, watch: mode === "watch" });
  const passthrough = Object.freeze([...args.passthrough]);
  return Object.freeze({ raw, options, passthrough });
}

export async function prepareResolvedServiceTaskOptions(options: {
  workspace: Workspace;
  args: ImmutableCliArguments;
  unit: PlannedEnvServiceUnit;
  components?: readonly WorkspaceComponent[] | undefined;
  config?: JsonObject | undefined;
  runtime?: JsonObject | undefined;
  taskId?: string | undefined;
  taskLabel?: string | undefined;
}): Promise<VendorTaskStartOptions> {
  const { group, service } = options.unit;
  const vendorUrl = await resolveVendorSpecifier({
    specifier: service.definition.vendor,
    service,
    workspaceRoot: options.workspace.rootDir,
    selectedEnv: group.env.env.packageName,
    serviceName: service.name,
  });
  return {
    vendorUrl,
    context: createVendorContext({
      workspace: options.workspace,
      args: options.args as CliArguments,
      env: group.env,
      service,
    }),
    components: options.components ?? group.components,
    config: options.config ?? service.definition.config ?? {},
    ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
    ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
    ...(options.taskLabel === undefined ? {} : { taskLabel: options.taskLabel }),
  };
}

export async function runVendorExecutionPlan<
  Unit,
  Context,
  Prepared,
  RunResult,
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
>(options: {
  plan: VendorExecutionPlan<Unit>;
  definition: VendorExecutionDefinition<
    Unit,
    Context,
    Prepared,
    RunResult,
    EventResult,
    InputMessage
  >;
  context: Context;
  args: CliArguments;
}): Promise<VendorRunExecution<Unit, Prepared, RunResult, InputMessage>> {
  const definition = defineVendorExecution(options.definition);
  const plan = validateVendorExecutionPlan(options.plan);
  if (!definition.run) {
    throw new Error(`Vendor execution definition "${definition.serviceId}" does not support run`);
  }
  const run = definition.run;
  const args = createEffectiveVendorArguments(options.args, "run");
  const outcomes: VendorRunOutcome<Unit, Prepared, RunResult, InputMessage>[] = [];
  const outcomeById = new Map<
    string,
    VendorRunOutcome<Unit, Prepared, RunResult, InputMessage>
  >();

  for (const layer of plan.layers) {
    const layerOutcomes = await Promise.all(layer.map(async (unit) => {
      const blockedBy = unit.dependsOn.filter((dependencyId) => {
        const dependency = outcomeById.get(dependencyId);
        return dependency?.status === "failed" || dependency?.status === "blocked";
      });
      if (blockedBy.length > 0) {
        return { status: "blocked", unit, blockedBy } as const;
      }

      try {
        const prepared = await definition.prepare({
          unit,
          args,
          mode: "run",
          context: options.context,
        });
        let executedTask: VendorTask<RunResult, JsonValue, InputMessage> | undefined;
        const [result] = await runVendorTasks<RunResult, InputMessage>(
          [prepared.taskOptions],
          {
            serviceId: definition.serviceId,
            label: definition.label,
            formatResult: (value) => run.formatResult(value, unit),
            printResults(_results, tasks) {
              executedTask = tasks[0];
            },
          }
        );
        if (!result) {
          throw new Error(`Vendor execution unit "${unit.id}" completed without a result`);
        }
        if (!executedTask) {
          throw new Error(`Vendor execution unit "${unit.id}" completed without a task`);
        }
        return { status: "successful", unit, prepared, result, task: executedTask } as const;
      } catch (error) {
        return { status: "failed", unit, error: asError(error) } as const;
      }
    }));

    for (const outcome of layerOutcomes) {
      outcomes.push(outcome);
      outcomeById.set(outcome.unit.id, outcome);
    }
  }

  return { plan, args, outcomes };
}

export async function createVendorWatchExecution<
  Unit,
  Context,
  Prepared,
  RunResult,
  EventResult extends JsonValue,
  InputMessage extends JsonValue = JsonValue,
>(options: {
  plan: VendorExecutionPlan<Unit>;
  definition: VendorExecutionDefinition<
    Unit,
    Context,
    Prepared,
    RunResult,
    EventResult,
    InputMessage
  >;
  context: Context;
  args: CliArguments;
}): Promise<VendorWatchExecution<Unit, Prepared, EventResult, InputMessage>> {
  const definition = defineVendorExecution(options.definition);
  const plan = validateVendorExecutionPlan(options.plan);
  if (!definition.watch) {
    throw new Error(`Vendor execution definition "${definition.serviceId}" does not support watch`);
  }
  const watch = definition.watch;
  const isLayeredExecution = plan.layers.length > 1;
  if (isLayeredExecution && watch.activation !== "eager") {
    throw new Error(
      `Multi-layer vendor watch execution "${definition.serviceId}" requires eager activation`
    );
  }
  const args = createEffectiveVendorArguments(options.args, "watch");
  const preparedUnits: PreparedVendorWatchUnit<Unit, Prepared, EventResult, InputMessage>[] = [];
  const preparationFailures: VendorWatchPreparationFailure<Unit>[] = [];
  const tasks: VendorWatchTask<EventResult, InputMessage>[] = [];
  const preparedForCleanup: Array<{
    unit: PlannedUnit<Unit>;
    prepared: PreparedVendorUnit<Prepared>;
  }> = [];
  const preparedUnitById = new Map<
    string,
    PreparedVendorWatchUnit<Unit, Prepared, EventResult, InputMessage>
  >();
  const readinessByUnitId = new Map<
    string,
    Promise<ReadyVendorWatchUnit<Unit, Prepared, EventResult, InputMessage>>
  >();
  let disposed = false;
  let disposePromise: Promise<void> | undefined;

  const execution: VendorWatchExecution<Unit, Prepared, EventResult, InputMessage> = {
    plan,
    args,
    preparedUnits,
    preparationFailures,
    tasks,
    ensureUnitReady(unitId) {
      if (disposed) {
        return Promise.reject(
          new Error(`Vendor watch execution "${definition.serviceId}" has been disposed`)
        );
      }
      const existing = readinessByUnitId.get(unitId);
      if (existing) return existing;
      const preparedUnit = preparedUnitById.get(unitId);
      if (!preparedUnit) {
        return Promise.reject(
          new Error(`Vendor watch execution unit "${unitId}" is not prepared`)
        );
      }

      const readiness = (async () => {
        try {
          await preparedUnit.task.activate();
          if (disposed) {
            throw new Error(`Vendor watch execution "${definition.serviceId}" has been disposed`);
          }
          const result = await preparedUnit.task.firstResult;
          if (disposed) {
            throw new Error(`Vendor watch execution "${definition.serviceId}" has been disposed`);
          }
          return { ...preparedUnit, result };
        } catch (error) {
          const failure = disposed
            ? new Error(`Vendor watch execution "${definition.serviceId}" has been disposed`)
            : asError(error);
          await Promise.resolve(preparedUnit.task.stop()).catch(() => undefined);
          throw failure;
        }
      })();
      readinessByUnitId.set(unitId, readiness);
      return readiness;
    },
    dispose() {
      if (disposePromise) return disposePromise;
      disposed = true;
      disposePromise = (async () => {
        const failures: unknown[] = [];
        try {
          await stopVendorTasks(tasks);
        } catch (error) {
          failures.push(error);
        }
        for (const { unit, prepared } of [...preparedForCleanup].reverse()) {
          try {
            await definition.cleanupPrepared?.(prepared, unit);
          } catch (error) {
            failures.push(error);
          }
        }
        throwCombinedErrors(
          failures,
          `Failed to dispose vendor watch execution "${definition.serviceId}"`
        );
      })();
      return disposePromise;
    },
  };

  try {
    for (const layer of plan.layers) {
      const preparation = await Promise.all(layer.map(async (unit) => {
        try {
          return {
            status: "fulfilled" as const,
            unit,
            prepared: await definition.prepare({
              unit,
              args,
              mode: "watch",
              context: options.context,
            }),
          };
        } catch (error) {
          return { status: "rejected" as const, unit, error: asError(error) };
        }
      }));
      const successful: Array<{
        status: "fulfilled";
        unit: PlannedUnit<Unit>;
        prepared: PreparedVendorUnit<Prepared>;
      }> = [];
      const failed: Array<{
        status: "rejected";
        unit: PlannedUnit<Unit>;
        error: Error;
      }> = [];
      for (const item of preparation) {
        if (item.status === "fulfilled") successful.push(item);
        else failed.push(item);
      }
      for (const item of successful) {
        preparedForCleanup.push({ unit: item.unit, prepared: item.prepared });
      }
      if (isLayeredExecution && failed.length > 0) {
        throw failed[0]!.error;
      }
      preparationFailures.push(...failed.map(({ unit, error }) => ({ unit, error })));
      await watch.finalizePreparedLayer?.(
        successful.map(({ unit, prepared }) => ({ unit, prepared })),
        options.context,
        args
      );

      const creation = await Promise.all(successful.map(async (item) => {
        try {
          const [task] = await createWatchVendorTasks<EventResult, InputMessage>(
            [item.prepared.taskOptions],
            {
              serviceId: definition.serviceId,
              label: definition.label,
              activation: watch.activation,
              formatResult: (value) => watch.formatResult(value, item.unit),
              ...(watch.onResult
                ? {
                    onResult: (
                      result: EventResult,
                      task: VendorWatchTask<EventResult, InputMessage>
                    ) => watch.onResult?.(result, task, item.unit, options.context),
                  }
                : {}),
              ...(watch.worker === undefined ? {} : { worker: watch.worker }),
            }
          );
          if (!task) throw new Error(`Vendor watch task was not created for unit "${item.unit.id}"`);
          return { status: "fulfilled" as const, item, task };
        } catch (error) {
          return { status: "rejected" as const, error: asError(error) };
        }
      }));
      const creationFailure = creation.find((item) => item.status === "rejected");
      const layerPreparedUnits = creation.flatMap((item) =>
        item.status === "fulfilled"
          ? [{
              unit: item.item.unit,
              prepared: item.item.prepared,
              task: item.task,
            }]
          : []
      );
      preparedUnits.push(...layerPreparedUnits);
      for (const preparedUnit of layerPreparedUnits) {
        preparedUnitById.set(preparedUnit.unit.id, preparedUnit);
      }
      const layerTasks = layerPreparedUnits.map(({ task }) => task);
      tasks.push(...layerTasks);
      for (const task of layerTasks) void task.result.catch(() => undefined);
      if (creationFailure) throw creationFailure.error;

      if (isLayeredExecution) {
        await Promise.all(layerTasks.map((task) => task.firstResult));
      }
    }

    return execution;
  } catch (error) {
    try {
      await execution.dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Failed to create vendor watch execution "${definition.serviceId}"`
      );
    }
    throw error;
  }
}

function assertServiceId(serviceId: string) {
  if (serviceId.length === 0) {
    throw new Error("Vendor execution service ID must be non-empty");
  }
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function throwCombinedErrors(errors: unknown[], message: string): void {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, message);
}

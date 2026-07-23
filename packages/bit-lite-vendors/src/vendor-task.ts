import { createRunner } from "./runner/index.js";
import { isVendorDefinition } from "./vendor-definition.js";
import {
  formatError,
  formatExitCode,
  isRecord,
  throwCombinedErrors,
} from "bit-lite-utils";
import { isInteractiveTerminal } from "bit-lite-utils/node";
import { ManagedTerminal, RawOutputBuffer } from "bit-lite-terminal";
import { getSelectedEnvKey } from "bit-lite-context";
import type {
  WorkspaceComponent,
} from "bit-lite-context";
import type {
  ManagedTerminalItem,
  ManagedTerminalOptions,
  TerminalOutputStream,
} from "bit-lite-terminal";
import type { RunnerExitCode, RunnerMode } from "./runner/index.js";
import type { WorkerRunnerOptions } from "./runner/index.js";
import type {
  JsonObject,
  JsonValue,
  VendorConfig,
  VendorContext,
  VendorData,
  VendorDefinition,
  VendorMessage,
  VendorRunner,
} from "./types/index.js";

export type VendorTaskStartOptions = {
  vendorUrl: string;
  context: VendorContext;
  components: readonly WorkspaceComponent[];
  config: VendorConfig;
  runtime?: JsonObject | undefined;
  taskId?: string | undefined;
  taskLabel?: string | undefined;
};

export type VendorTaskRunResult<RunResult = unknown> = {
  context: VendorContext;
  vendor: VendorDefinition;
  data: RunResult;
};

export type VendorTask<
  RunResult = unknown,
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
> = ManagedTerminalItem & {
  context: VendorContext;
  vendor: VendorDefinition;
  result: Promise<VendorTaskRunResult<RunResult>>;
  activate(): Promise<void>;
  postMessage(message: InputMessage): void;
  stop(): Promise<void>;
  onMessage?(listener: (message: VendorMessage<EventResult>) => void): () => void;
  onOutput?(listener: (stream: TerminalOutputStream, chunk: Buffer) => void): () => void;
};

export type VendorWatchTask<
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
> = VendorTask<unknown, EventResult, InputMessage> & {
  firstResult: Promise<EventResult>;
  onResult(
    listener: (result: EventResult, task: VendorWatchTask<EventResult, InputMessage>) => void
  ): () => void;
};

export type RunVendorTasksOptions<
  RunResult = unknown,
  InputMessage extends JsonValue = JsonValue,
> = {
  serviceId: string;
  label: string;
  formatResult(result: unknown): RunResult | Error;
  printResults(
    results: VendorTaskRunResult<RunResult>[],
    tasks: VendorTask<RunResult, JsonValue, InputMessage>[]
  ): void | Promise<void>;
};

export type CreateWatchVendorTasksOptions<
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
> = {
  serviceId: string;
  label: string;
  formatResult(result: unknown): string[] | Error;
  onResult?(result: EventResult, task: VendorWatchTask<EventResult, InputMessage>): void;
  activation?: "eager" | "deferred" | undefined;
  worker?: WorkerRunnerOptions | undefined;
};

export type SuperviseVendorTasksOptions<
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
> = {
  title: ManagedTerminalOptions<VendorTask<unknown, EventResult, InputMessage>>["title"];
  canAttach?: ManagedTerminalOptions<VendorTask<unknown, EventResult, InputMessage>>["canAttach"];
  dispose(): Promise<void>;
  interactive?: boolean | undefined;
  terminal?: Pick<
    ManagedTerminalOptions<VendorTask<unknown, EventResult, InputMessage>>,
    "stdin" | "stdout" | "stderr"
  > | undefined;
};

type WatchSessionSignal = "sigint" | "sigterm";

type CreateVendorTaskOptions = VendorTaskStartOptions & {
  mode: RunnerMode;
  activation: "eager" | "deferred";
  worker?: WorkerRunnerOptions | undefined;
};

type CreateVendorTaskResultOptions<
  RunResult,
  EventResult extends JsonValue,
  InputMessage extends JsonValue = JsonValue,
> = {
  serviceId: string;
  label: string;
  runResult?: {
    formatResult(result: unknown): RunResult | Error;
  };
  eventResult?: {
    formatResult(result: unknown): string[] | Error;
    onResult?(result: EventResult, task: VendorTask<unknown, EventResult, InputMessage>): void;
  };
};

type ManagedVendorTask<
  RunResult = unknown,
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
> = VendorTask<RunResult, EventResult, InputMessage> & {
  serviceId: string;
  serviceLabel: string;
  runner?: VendorRunner<VendorConfig, RunResult, EventResult, InputMessage> | undefined;
  completed: boolean;
  runResult?: CreateVendorTaskResultOptions<RunResult, EventResult, InputMessage>["runResult"];
  eventResult?: CreateVendorTaskResultOptions<RunResult, EventResult, InputMessage>["eventResult"];
  resolveResult?: ((result: VendorTaskRunResult<RunResult>) => void) | undefined;
  rejectResult?: ((error: unknown) => void) | undefined;
  firstResult: Promise<EventResult>;
  firstResultSettled: boolean;
  resolveFirstResult(result: EventResult): void;
  rejectFirstResult(error: unknown): void;
  resultListeners: Set<
    (result: EventResult, task: VendorWatchTask<EventResult, InputMessage>) => void
  >;
  onResult(
    listener: (result: EventResult, task: VendorWatchTask<EventResult, InputMessage>) => void
  ): () => void;
  eventResultsClosed: boolean;
};

export async function runVendorTasks<
  RunResult = unknown,
  InputMessage extends JsonValue = JsonValue,
>(
  taskOptions: VendorTaskStartOptions[],
  options: RunVendorTasksOptions<RunResult, InputMessage>
) {
  const tasks = await createVendorTasks<RunResult, JsonValue, InputMessage>(
    taskOptions,
    "inline",
    {
      serviceId: options.serviceId,
      label: options.label,
      runResult: {
        formatResult: options.formatResult,
      },
    }
  );

  try {
    const results = await Promise.all(tasks.map((task) => task.result));
    await options.printResults(results, tasks);
    return results;
  } finally {
    await stopVendorTasks(tasks);
  }
}

export function createWatchVendorTasks<
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
>(
  taskOptions: VendorTaskStartOptions[],
  options: CreateWatchVendorTasksOptions<EventResult, InputMessage>
) {
  return createVendorTasks<unknown, EventResult, InputMessage>(
    taskOptions,
    "worker",
    {
      serviceId: options.serviceId,
      label: options.label,
      eventResult: {
        formatResult: options.formatResult,
        ...(options.onResult ? { onResult: options.onResult } : {}),
      },
    },
    {
      worker: options.worker,
      activation: options.activation ?? "eager",
    }
  ) as Promise<VendorWatchTask<EventResult, InputMessage>[]>;
}

export async function superviseVendorTasks<
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
>(
  tasks: VendorTask<unknown, EventResult, InputMessage>[],
  options: SuperviseVendorTasksOptions<EventResult, InputMessage>
) {
  const interactive = options.interactive ?? isInteractiveTerminal();

  if (tasks.length === 0) return tasks;

  let cleanedUp = false;
  let disposalPromise: Promise<void> | undefined;
  let resolveShutdown!: () => void;
  let rejectShutdown!: (error: unknown) => void;
  const shutdownRequestedPromise = new Promise<void>((resolve, reject) => {
    resolveShutdown = resolve;
    rejectShutdown = reject;
  });
  const terminal = interactive
    ? new ManagedTerminal<VendorTask<unknown, EventResult, InputMessage>>({
        title: options.title,
        items: tasks,
        canAttach: options.canAttach ?? ((item) => item.canAttach === true),
        onInterrupt() {
          requestShutdown("sigint");
        },
        ...(options.terminal ?? {}),
      })
    : undefined;

  for (const task of tasks) {
    void task.result.catch(() => undefined);
  }

  const unsubscribers = tasks.flatMap((task) => [
    task.onMessage?.(() => {
      terminal?.scheduleRender();
    }),
    task.onOutput?.((stream, chunk) => {
      terminal?.writeOutput(task, stream, chunk);
    }),
  ]);

  const handleSigint = () => {
    requestShutdown("sigint");
  };
  const handleSigterm = () => {
    requestShutdown("sigterm");
  };

  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);

  try {
    terminal?.start();
    await shutdownRequestedPromise;
  } catch (error) {
    cleanupWatchListeners();
    terminal?.stop({ clearScreen: true });
    throw error;
  }

  return tasks;

  function requestShutdown(reason: WatchSessionSignal) {
    void shutdown(reason).then(resolveShutdown, rejectShutdown);
  }

  function shutdown(reason: WatchSessionSignal) {
    if (disposalPromise) return disposalPromise;
    terminal?.stop({ clearScreen: true });
    cleanupWatchListeners();
    disposalPromise = (async () => {
      try {
        await options.dispose();
      } finally {
        killProcessForShutdownReason(reason);
      }
    })();
    return disposalPromise;
  }

  function cleanupWatchListeners() {
    if (cleanedUp) return;
    cleanedUp = true;
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
    for (const unsubscribe of unsubscribers) unsubscribe?.();
  }
}

export async function stopVendorTasks<
  RunResult = unknown,
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
>(tasks: VendorTask<RunResult, EventResult, InputMessage>[]) {
  const outcomes = await Promise.allSettled(tasks.map((task) => task.stop()));
  const failures = outcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : []
  );
  throwCombinedErrors(failures, "Failed to stop vendor tasks");
}

function killProcessForShutdownReason(reason: WatchSessionSignal) {
  switch (reason) {
    case "sigint":
      process.kill(process.pid, "SIGINT");
      return;
    case "sigterm":
      process.kill(process.pid, "SIGTERM");
      return;
  }
}

async function createVendorTasks<
  RunResult = unknown,
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
>(
  taskOptions: VendorTaskStartOptions[],
  mode: RunnerMode,
  resultOptions: CreateVendorTaskResultOptions<RunResult, EventResult, InputMessage>,
  runnerOptions: {
    worker?: WorkerRunnerOptions | undefined;
    activation?: "eager" | "deferred" | undefined;
  } = {}
): Promise<VendorTask<RunResult, EventResult, InputMessage>[]> {
  const tasks: VendorTask<RunResult, EventResult, InputMessage>[] = [];

  try {
    for (const taskOption of taskOptions) {
      tasks.push(
        await createVendorTask<RunResult, EventResult, InputMessage>(
          {
            ...taskOption,
            mode,
            activation: mode === "worker" ? runnerOptions.activation ?? "eager" : "eager",
          },
          runnerOptions,
          resultOptions
        )
      );
    }
    return tasks;
  } catch (error) {
    await stopVendorTasks(tasks);
    throw error;
  }
}

async function createVendorTask<
  RunResult = unknown,
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
>(
  options: CreateVendorTaskOptions,
  runnerOptions: { worker?: WorkerRunnerOptions | undefined },
  resultOptions: CreateVendorTaskResultOptions<RunResult, EventResult, InputMessage>
): Promise<VendorTask<RunResult, EventResult, InputMessage>> {
  if (resultOptions.serviceId !== options.context.service.name) {
    throw new Error(
      `Vendor task service "${resultOptions.serviceId}" does not match context service ` +
      `"${options.context.service.name}" for selected env "${options.context.env.packageName}"`
    );
  }
  const vendor = await loadVendor(
    options.vendorUrl,
    options.context.service.name,
    options.context
  );

  return createManagedVendorTask<RunResult, EventResult, InputMessage>(
    { ...options, worker: runnerOptions.worker },
    resultOptions,
    vendor
  );
}

function createManagedVendorTask<
  RunResult,
  EventResult extends JsonValue,
  InputMessage extends JsonValue,
>(
  options: CreateVendorTaskOptions,
  resultOptions: CreateVendorTaskResultOptions<RunResult, EventResult, InputMessage>,
  vendor: VendorDefinition
): VendorTask<RunResult, EventResult, InputMessage> {
  const data: VendorData<VendorConfig> = {
    context: options.context,
    components: options.components,
    config: options.config,
    ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
  };
  const messageListeners = new Set<(message: VendorMessage<EventResult>) => void>();
  const outputListeners = new Set<(stream: TerminalOutputStream, chunk: Buffer) => void>();
  const resultListeners = new Set<
    (result: EventResult, task: VendorWatchTask<EventResult, InputMessage>) => void
  >();
  let runner: VendorRunner<VendorConfig, RunResult, EventResult, InputMessage> | undefined;
  let activationPromise: Promise<void> | undefined;
  let activationError: Error | undefined;
  let runnerExited = false;
  let stopPromise: Promise<void> | undefined;
  let stopRequested = false;
  let resolveResult!: (result: VendorTaskRunResult<RunResult>) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<VendorTaskRunResult<RunResult>>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  let resolveFirstResult!: (result: EventResult) => void;
  let rejectFirstResult!: (error: unknown) => void;
  const firstResult = new Promise<EventResult>((resolve, reject) => {
    resolveFirstResult = resolve;
    rejectFirstResult = reject;
  });
  void firstResult.catch(() => undefined);

  const task: ManagedVendorTask<RunResult, EventResult, InputMessage> = {
    id: options.taskId ?? `${options.context.service.name}:${getSelectedEnvKey(options.context.env)}:${vendor.id}`,
    label: options.taskLabel ?? (options.mode === "worker"
      ? `${resultOptions.label}: ${vendor.label} (${options.context.env.packageName})`
      : `${vendor.label} (${options.context.env.packageName})`),
    context: options.context,
    vendor,
    serviceId: options.context.service.name,
    serviceLabel: resultOptions.label,
    hint: vendor.hint,
    status: options.activation === "deferred" ? "idle" : "starting",
    details: [],
    rawOutput: new RawOutputBuffer(),
    result,
    completed: false,
    runResult: resultOptions.runResult,
    eventResult: resultOptions.eventResult,
    resolveResult,
    rejectResult,
    firstResult,
    firstResultSettled: false,
    resolveFirstResult,
    rejectFirstResult,
    resultListeners,
    eventResultsClosed: false,
    activate() {
      if (activationPromise) return activationPromise;
      if (stopRequested) {
        return Promise.reject(new Error(`${task.label} cannot activate after it was stopped`));
      }

      task.status = "starting";
      activationPromise = startRunner();
      return activationPromise;
    },
    postMessage(message) {
      runner?.postMessage(message);
    },
    stop() {
      if (stopPromise) return stopPromise;
      stopRequested = true;
      closeEventResults(task, new Error(`${task.label} stopped before its first valid result`));
      stopPromise = (async () => {
        const activeRunner = runner;
        if (!activeRunner) {
          task.status = "stopped";
          return;
        }
        const runnerHadExited = runnerExited;

        const failures: unknown[] = [];
        void Promise.resolve(activeRunner.stop()).catch((error) => {
          failures.push(error);
        });
        const gracefulExit = await waitForRunnerExit(
          activeRunner.exitPromise,
          gracefulExitTimeoutMs
        );
        if (!gracefulExit.timedOut) {
          task.status = "stopped";
          if (
            gracefulExit.code !== 0 &&
            !runnerHadExited &&
            activationError === undefined
          ) {
            failures.push(
              new Error(`${task.label} failed to stop with exit code ${formatExitCode(gracefulExit.code)}`)
            );
          }
          throwCombinedErrors(failures, `Failed to stop ${task.label}`);
          return;
        }

        const forcedTermination = await waitForPromise(
          Promise.resolve(activeRunner.terminate()),
          forcedTerminationTimeoutMs
        );
        if (forcedTermination.status === "rejected") {
          failures.push(forcedTermination.reason);
        }
        task.status = "stopped";
        throwCombinedErrors(failures, `Failed to stop ${task.label}`);
      })();
      return stopPromise;
    },
    writeInput(chunk) {
      runner?.writeInput(chunk);
    },
    canAttach: false,
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onResult(listener) {
      resultListeners.add(listener);
      return () => resultListeners.delete(listener);
    },
    onOutput(listener) {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
  };

  if (options.activation === "eager") void task.activate().catch(() => undefined);

  return task;

  async function startRunner() {
    if (stopRequested) throw new Error(`${task.label} cannot activate after it was stopped`);

    const createdRunner = createRunner<
      VendorData<VendorConfig>,
      VendorMessage<EventResult>,
      InputMessage,
      RunResult
    >({
      mode: options.mode,
      target: vendor,
      data,
      worker: options.worker,
    });
    runner = createdRunner;
    task.runner = createdRunner;
    task.canAttach = options.mode === "worker";

    createdRunner.exitPromise.then((code) => {
      runnerExited = true;
      if (stopRequested) task.status = "stopped";
      else handleVendorExit(task, code);
    });
    createdRunner.onMessage((message) => {
      if (message.type === "error") activationError = new Error(message.message);
      handleVendorMessage(task, message);
      for (const listener of messageListeners) listener(message);
    });
    createdRunner.onOutput((stream, chunk) => {
      task.rawOutput.append(stream, chunk);
      for (const listener of outputListeners) listener(stream, chunk);
    });

    if (stopRequested) {
      await createdRunner.stop();
      throw new Error(`${task.label} stopped during activation`);
    }

    try {
      const resultData = await createdRunner.start();
      if (stopRequested) {
        await createdRunner.stop();
        throw new Error(`${task.label} stopped during activation`);
      }
      if (resultData !== undefined) {
        recordVendorRunResult(task, resultData);
      } else if (task.runResult !== undefined && createdRunner.kind === "inline" && !task.completed) {
        rejectVendorRun(task, new Error(`${task.label} completed without a result`));
      }
    } catch (error) {
      const failure = activationError ?? error;
      if (!stopRequested) rejectVendorRun(task, failure);
      throw failure;
    }
  }

}

const gracefulExitTimeoutMs = 300;
const forcedTerminationTimeoutMs = 300;

type TimedPromiseOutcome<Result> =
  | { status: "fulfilled"; value: Result }
  | { status: "rejected"; reason: unknown }
  | { status: "timed-out" };

function waitForPromise<Result>(
  promise: Promise<Result>,
  timeoutMs: number
): Promise<TimedPromiseOutcome<Result>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ status: "timed-out" }), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ status: "fulfilled", value });
      },
      (reason) => {
        clearTimeout(timer);
        resolve({ status: "rejected", reason });
      }
    );
  });
}

async function waitForRunnerExit(exitPromise: Promise<RunnerExitCode>, timeoutMs: number) {
  const outcome = await waitForPromise(exitPromise, timeoutMs);
  return outcome.status === "fulfilled"
    ? { timedOut: false as const, code: outcome.value }
    : { timedOut: true as const };
}

function handleVendorMessage<
  RunResult,
  EventResult extends JsonValue,
  InputMessage extends JsonValue,
>(
  task: ManagedVendorTask<RunResult, EventResult, InputMessage>,
  message: VendorMessage<EventResult>
) {
  if (message.type === "ready") {
    task.status = "ready";
    return;
  }

  if (message.type === "status") {
    task.status = message.status;
    return;
  }

  if (message.type === "error") {
    task.status = "error";
    rejectVendorRun(task, new Error(message.message));
    return;
  }

  recordVendorEventResult(task, message.data);
}

function handleVendorExit<
  RunResult,
  EventResult extends JsonValue,
  InputMessage extends JsonValue,
>(
  task: ManagedVendorTask<RunResult, EventResult, InputMessage>,
  code: RunnerExitCode
) {
  closeEventResults(
    task,
    new Error(`${task.label} exited before producing its first valid result`)
  );
  if (code === 0) {
    if (task.runResult !== undefined && !task.completed) {
      rejectVendorRun(task, new Error(`${task.label} completed without a result`));
    }
    task.status = "stopped";
    return;
  }

  task.status = `exited ${formatExitCode(code)}`;
  if (!task.completed) {
    rejectVendorRun(task, new Error(`${task.label} exited with code ${formatExitCode(code)}`));
  }
}

function recordVendorRunResult<
  RunResult,
  EventResult extends JsonValue,
  InputMessage extends JsonValue,
>(
  task: ManagedVendorTask<RunResult, EventResult, InputMessage>,
  result: unknown
) {
  if (task.completed) return;

  if (task.runResult === undefined) {
    task.completed = true;
    task.resolveResult?.({
      context: task.context,
      vendor: task.vendor,
      data: result as RunResult,
    });
    return;
  }

  const formatted = callFormatResult(task.runResult.formatResult, result);
  if (formatted instanceof Error) {
    rejectVendorRun(task, formatted);
    return;
  }

  task.completed = true;
  task.resolveResult?.({
    context: task.context,
    vendor: task.vendor,
    data: formatted,
  });
}

function recordVendorEventResult<
  RunResult,
  EventResult extends JsonValue,
  InputMessage extends JsonValue,
>(
  task: ManagedVendorTask<RunResult, EventResult, InputMessage>,
  result: unknown
) {
  if (task.eventResult === undefined || task.completed || task.eventResultsClosed) return;

  const details = callFormatResult(task.eventResult.formatResult, result);
  if (details instanceof Error) {
    rejectVendorRun(task, details);
    return;
  }

  task.details = details;
  const validatedResult = result as EventResult;
  if (!task.firstResultSettled) {
    task.firstResultSettled = true;
    task.resolveFirstResult(validatedResult);
  }
  const watchTask = task as unknown as VendorWatchTask<EventResult, InputMessage>;
  for (const listener of task.resultListeners) listener(validatedResult, watchTask);
  task.eventResult.onResult?.(validatedResult, watchTask);
}

function rejectVendorRun<
  RunResult,
  EventResult extends JsonValue,
  InputMessage extends JsonValue,
>(
  task: ManagedVendorTask<RunResult, EventResult, InputMessage>,
  error: unknown
) {
  if (task.completed) return;
  task.completed = true;
  const failure = error instanceof Error ? error : new Error(formatError(error));
  closeEventResults(task, failure);
  task.rejectResult?.(failure);
}

function closeEventResults<
  RunResult,
  EventResult extends JsonValue,
  InputMessage extends JsonValue,
>(
  task: ManagedVendorTask<RunResult, EventResult, InputMessage>,
  error: Error
) {
  task.eventResultsClosed = true;
  if (task.firstResultSettled) return;
  task.firstResultSettled = true;
  task.rejectFirstResult(error);
}

function callFormatResult<Result>(
  formatResult: (result: unknown) => Result | Error,
  result: unknown
) {
  try {
    return formatResult(result);
  } catch (error) {
    return error instanceof Error ? error : new Error(formatError(error));
  }
}

async function loadVendor(
  resolvedUrl: string,
  serviceId: string,
  context: VendorContext
): Promise<VendorDefinition> {
  let vendorModule: unknown;
  try {
    vendorModule = await import(resolvedUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to import ${serviceId} vendor for selected env "${context.env.packageName}" ` +
      `(declared by "${context.service.source.identity.packageName}") from ${resolvedUrl}: ${message}`
    );
  }

  if (!isRecord(vendorModule) || !isVendorDefinition(vendorModule.meta)) {
    throw new Error(
      `${serviceId} vendor for selected env "${context.env.packageName}" ` +
      `(declared by "${context.service.source.identity.packageName}") at ${resolvedUrl} ` +
      `must export const meta: VendorDefinition`
    );
  }

  return vendorModule.meta;
}

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
import { getSelectedEnvKey } from "bit-lite-env-resolution";
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

/**
 * The object `createManagedVendorTask` builds. Every task carries the watch
 * fields; `createWatchVendorTasks` is what promises them to a caller, because
 * only a watch task's results are meaningful to subscribe to.
 */
type ConcreteVendorTask<
  RunResult,
  EventResult extends JsonValue,
  InputMessage extends JsonValue,
> = VendorTask<RunResult, EventResult, InputMessage> &
  Pick<VendorWatchTask<EventResult, InputMessage>, "firstResult" | "onResult">;

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

/**
 * Builds one vendor task around a runner.
 *
 * All of the task's mutable state — whether it completed, whether its first
 * watch result has settled, which promises are still open — lives in this
 * closure rather than on the returned object. Callers see the contract and
 * nothing else, and the state machine below is readable in one place.
 */
function createManagedVendorTask<
  RunResult,
  EventResult extends JsonValue,
  InputMessage extends JsonValue,
>(
  options: CreateVendorTaskOptions,
  resultOptions: CreateVendorTaskResultOptions<RunResult, EventResult, InputMessage>,
  vendor: VendorDefinition
): ConcreteVendorTask<RunResult, EventResult, InputMessage> {
  const { runResult, eventResult } = resultOptions;
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
  let completed = false;
  let firstResultSettled = false;
  let eventResultsClosed = false;

  const run = createDeferred<VendorTaskRunResult<RunResult>>();
  const first = createDeferred<EventResult>();
  void first.promise.catch(() => undefined);

  const task: ConcreteVendorTask<RunResult, EventResult, InputMessage> = {
    id: options.taskId ?? `${options.context.service.name}:${getSelectedEnvKey(options.context.env)}:${vendor.id}`,
    label: options.taskLabel ?? (options.mode === "worker"
      ? `${resultOptions.label}: ${vendor.label} (${options.context.env.packageName})`
      : `${vendor.label} (${options.context.env.packageName})`),
    context: options.context,
    vendor,
    hint: vendor.hint,
    status: options.activation === "deferred" ? "idle" : "starting",
    details: [],
    rawOutput: new RawOutputBuffer(),
    result: run.promise,
    firstResult: first.promise,
    canAttach: false,
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
    writeInput(chunk) {
      runner?.writeInput(chunk);
    },
    stop() {
      if (stopPromise) return stopPromise;
      stopRequested = true;
      closeEventResults(new Error(`${task.label} stopped before its first valid result`));
      stopPromise = stopRunner();
      return stopPromise;
    },
    onMessage: (listener) => subscribe(messageListeners, listener),
    onOutput: (listener) => subscribe(outputListeners, listener),
    onResult: (listener) => subscribe(resultListeners, listener),
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
    task.canAttach = options.mode === "worker";

    createdRunner.exitPromise.then((code) => {
      runnerExited = true;
      if (stopRequested) task.status = "stopped";
      else handleExit(code);
    });
    createdRunner.onMessage((message) => {
      if (message.type === "error") activationError = new Error(message.message);
      handleMessage(message);
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
        recordRunResult(resultData);
      } else if (runResult !== undefined && createdRunner.kind === "inline" && !completed) {
        fail(new Error(`${task.label} completed without a result`));
      }
    } catch (error) {
      const failure = activationError ?? error;
      if (!stopRequested) fail(failure);
      throw failure;
    }
  }

  /**
   * Asks the runner to stop, then escalates. A runner that has not exited
   * within the grace period is terminated, so one task refusing to leave can
   * never hold up the session's shutdown.
   */
  async function stopRunner() {
    const activeRunner = runner;
    if (!activeRunner) {
      task.status = "stopped";
      return;
    }
    const runnerHadExited = runnerExited;
    const failures: unknown[] = [];
    void Promise.resolve(activeRunner.stop()).catch((error) => failures.push(error));

    const gracefulExit = await waitForPromise(activeRunner.exitPromise, gracefulExitTimeoutMs);
    if (gracefulExit.status !== "timed-out") {
      task.status = "stopped";
      const code = gracefulExit.status === "fulfilled" ? gracefulExit.value : undefined;
      if (code !== 0 && !runnerHadExited && activationError === undefined) {
        failures.push(
          new Error(`${task.label} failed to stop with exit code ${formatExitCode(code)}`)
        );
      }
    } else {
      const forced = await waitForPromise(
        Promise.resolve(activeRunner.terminate()),
        forcedTerminationTimeoutMs
      );
      if (forced.status === "rejected") failures.push(forced.reason);
      task.status = "stopped";
    }
    throwCombinedErrors(failures, `Failed to stop ${task.label}`);
  }

  function handleMessage(message: VendorMessage<EventResult>) {
    switch (message.type) {
      case "ready":
        task.status = "ready";
        return;
      case "status":
        task.status = message.status;
        return;
      case "error":
        task.status = "error";
        fail(new Error(message.message));
        return;
      case "result":
        recordEventResult(message.data);
    }
  }

  function handleExit(code: RunnerExitCode) {
    closeEventResults(new Error(`${task.label} exited before producing its first valid result`));
    if (code === 0) {
      if (runResult !== undefined && !completed) {
        fail(new Error(`${task.label} completed without a result`));
      }
      task.status = "stopped";
      return;
    }
    task.status = `exited ${formatExitCode(code)}`;
    if (!completed) fail(new Error(`${task.label} exited with code ${formatExitCode(code)}`));
  }

  /** The single result of a one-shot run, settling `task.result`. */
  function recordRunResult(value: unknown) {
    if (completed) return;
    const formatted = runResult === undefined
      ? (value as RunResult)
      : callFormatResult(runResult.formatResult, value);
    if (formatted instanceof Error) {
      fail(formatted);
      return;
    }
    completed = true;
    run.resolve({ context: task.context, vendor: task.vendor, data: formatted });
  }

  /** One of the repeated results of a watch run, refreshing what the task shows. */
  function recordEventResult(value: unknown) {
    if (eventResult === undefined || completed || eventResultsClosed) return;

    const details = callFormatResult(eventResult.formatResult, value);
    if (details instanceof Error) {
      fail(details);
      return;
    }

    task.details = details;
    const validated = value as EventResult;
    if (!firstResultSettled) {
      firstResultSettled = true;
      first.resolve(validated);
    }
    const watchTask = task as unknown as VendorWatchTask<EventResult, InputMessage>;
    for (const listener of resultListeners) listener(validated, watchTask);
    eventResult.onResult?.(validated, watchTask);
  }

  function fail(error: unknown) {
    if (completed) return;
    completed = true;
    const failure = error instanceof Error ? error : new Error(formatError(error));
    closeEventResults(failure);
    run.reject(failure);
  }

  function closeEventResults(error: Error) {
    eventResultsClosed = true;
    if (firstResultSettled) return;
    firstResultSettled = true;
    first.reject(error);
  }
}

function subscribe<Listener>(listeners: Set<Listener>, listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: unknown) => void;
};

function createDeferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
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
    throw new Error(
      `Failed to import ${serviceId} vendor for selected env "${context.env.packageName}" ` +
      `(declared by "${context.service.source.identity.packageName}") from ${resolvedUrl}: ` +
      formatError(error)
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

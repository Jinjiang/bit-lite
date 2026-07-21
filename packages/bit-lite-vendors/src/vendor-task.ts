import { createRunner } from "./runner/index.js";
import { ManagedTerminal, RawOutputBuffer } from "bit-lite-terminal";
import { getSelectedEnvKey } from "bit-lite-context";
import type {
  WorkspaceComponent,
} from "bit-lite-context";
import type {
  ManagedTerminalItem,
  ManagedTerminalOptions,
  ManagedTerminalQuitReason,
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
  exitPromise?: Promise<RunnerExitCode> | undefined;
  activate(): Promise<void>;
  postMessage(message: InputMessage): void;
  stop(): void | Promise<void>;
  terminate?(): void | Promise<void>;
  onMessage?(listener: (message: VendorMessage<EventResult>) => void): () => void;
  onOutput?(listener: (stream: TerminalOutputStream, chunk: Buffer) => void): () => void;
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

export type WatchVendorTasksOptions<
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
> = CreateWatchVendorTasksOptions<EventResult, InputMessage> &
  SuperviseVendorTasksOptions<EventResult, InputMessage>;

export type CreateWatchVendorTasksOptions<
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
> = {
  serviceId: string;
  label: string;
  formatResult(result: unknown): string[] | Error;
  onResult?(result: EventResult, task: VendorTask<unknown, EventResult, InputMessage>): void;
  activation?: "eager" | "deferred" | undefined;
  worker?: WorkerRunnerOptions | undefined;
};

export type SuperviseVendorTasksOptions<
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
> = {
  title: ManagedTerminalOptions<VendorTask<unknown, EventResult, InputMessage>>["title"];
  canAttach?: ManagedTerminalOptions<VendorTask<unknown, EventResult, InputMessage>>["canAttach"];
  formatStoppingMessage?(reason: string): string | undefined;
  onTasksStarted?(
    tasks: VendorTask<unknown, EventResult, InputMessage>[]
  ): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
  interactive?: boolean | undefined;
  terminal?: Pick<
    ManagedTerminalOptions<VendorTask<unknown, EventResult, InputMessage>>,
    "stdin" | "stdout" | "stderr"
  > | undefined;
};

type WatchVendorTasksShutdownReason = ManagedTerminalQuitReason | "sigint" | "sigterm" | "completed";

export type StopVendorTasksOptions = {
  exitTimeoutMs?: number | undefined;
  terminateTimeoutMs?: number | undefined;
};

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

export async function watchVendorTasks<
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
>(
  taskOptions: VendorTaskStartOptions[],
  options: WatchVendorTasksOptions<EventResult, InputMessage>
) {
  const tasks = await createWatchVendorTasks(taskOptions, options);
  await superviseVendorTasks(tasks, options);
  return tasks;
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
  );
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

  let shuttingDown = false;
  let cleanedUp = false;
  let tasksStartedCleanedUp = false;
  let cleanupTasksStarted: (() => void | Promise<void>) | undefined;
  let resolveShutdown!: () => void;
  let rejectShutdown!: (error: unknown) => void;
  const shutdownPromise = new Promise<void>((resolve, reject) => {
    resolveShutdown = resolve;
    rejectShutdown = reject;
  });
  const terminal = interactive
    ? new ManagedTerminal<VendorTask<unknown, EventResult, InputMessage>>({
        title: options.title,
        items: tasks,
        canAttach: options.canAttach ?? ((item) => item.canAttach === true),
        onQuit(reason) {
          requestShutdown(reason);
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
    const cleanup = await options.onTasksStarted?.(tasks);
    if (typeof cleanup === "function") cleanupTasksStarted = cleanup;

    terminal?.start();
    await shutdownPromise;
  } finally {
    if (!shuttingDown) await shutdown("completed");
  }

  return tasks;

  function requestShutdown(reason: Exclude<WatchVendorTasksShutdownReason, "completed">) {
    void shutdown(reason).catch(rejectShutdown);
  }

  async function shutdown(reason: WatchVendorTasksShutdownReason) {
    if (shuttingDown) return;
    shuttingDown = true;

    terminal?.stop({ clearScreen: true });
    if (interactive && reason !== "completed") {
      const message = options.formatStoppingMessage?.(formatWatchShutdownReason(reason));
      if (message) process.stdout.write(message);
    }

    try {
      await stopVendorTasks(tasks);
    } finally {
      cleanupWatchListeners();
      await cleanupTasksStartedHook();
    }
    resolveShutdown();
    killProcessForShutdownReason(reason);
  }

  function cleanupWatchListeners() {
    if (cleanedUp) return;
    cleanedUp = true;
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
    for (const unsubscribe of unsubscribers) unsubscribe?.();
  }

  async function cleanupTasksStartedHook() {
    if (tasksStartedCleanedUp) return;
    tasksStartedCleanedUp = true;
    await cleanupTasksStarted?.();
  }
}

export async function stopVendorTasks<
  RunResult = unknown,
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
>(tasks: VendorTask<RunResult, EventResult, InputMessage>[], options: StopVendorTasksOptions = {}) {
  for (const task of tasks) {
    await task.stop();
  }

  const pendingTasks = new Set(tasks);
  const exitPromises = tasks
    .map((task) => task.exitPromise?.finally(() => pendingTasks.delete(task)))
    .filter((exitPromise): exitPromise is NonNullable<VendorTask["exitPromise"]> => exitPromise !== undefined);

  await Promise.race([
    Promise.allSettled(exitPromises),
    new Promise((resolve) => setTimeout(resolve, options.exitTimeoutMs ?? 300)),
  ]);

  if (pendingTasks.size === 0) return;

  const terminatePromises = Array.from(pendingTasks).map((task) => task.terminate?.());
  await Promise.race([
    Promise.allSettled(terminatePromises),
    new Promise((resolve) => setTimeout(resolve, options.terminateTimeoutMs ?? 300)),
  ]);
}

function formatWatchShutdownReason(reason: Exclude<WatchVendorTasksShutdownReason, "completed">) {
  switch (reason) {
    case "ctrl-c":
      return "received Ctrl+C";
    case "quit":
      return "quit requested";
    case "sigint":
      return "received SIGINT";
    case "sigterm":
      return "received SIGTERM";
  }
}

function killProcessForShutdownReason(reason: WatchVendorTasksShutdownReason) {
  switch (reason) {
    case "ctrl-c":
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
  let runner: VendorRunner<VendorConfig, RunResult, EventResult, InputMessage> | undefined;
  let activationPromise: Promise<void> | undefined;
  let activationError: Error | undefined;
  let stopPromise: Promise<void> | undefined;
  let stopRequested = false;
  let exitSettled = false;
  let resolveExit!: (code: RunnerExitCode) => void;
  const exitPromise = new Promise<RunnerExitCode>((resolve) => {
    resolveExit = resolve;
  });
  let resolveResult!: (result: VendorTaskRunResult<RunResult>) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<VendorTaskRunResult<RunResult>>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

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
    exitPromise,
    resolveResult,
    rejectResult,
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
      stopPromise = (async () => {
        if (runner) {
          await runner.stop();
          return;
        }
        task.status = "stopped";
        settleExit(0);
      })();
      return stopPromise;
    },
    async terminate() {
      stopRequested = true;
      if (runner) {
        await runner.terminate();
        return;
      }
      task.status = "stopped";
      settleExit(0);
    },
    writeInput(chunk) {
      runner?.writeInput(chunk);
    },
    canAttach: false,
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
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
      handleVendorExit(task, code);
      settleExit(code);
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

  function settleExit(code: RunnerExitCode) {
    if (exitSettled) return;
    exitSettled = true;
    resolveExit(code);
  }
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
  if (task.eventResult === undefined) return;

  const details = callFormatResult(task.eventResult.formatResult, result);
  if (details instanceof Error) {
    rejectVendorRun(task, details);
    return;
  }

  task.details = details;
  task.eventResult.onResult?.(result as EventResult, task);
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
  task.rejectResult?.(error instanceof Error ? error : new Error(formatError(error)));
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

function isVendorDefinition(value: unknown): value is VendorDefinition {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.hint === "string" &&
    (typeof value.moduleUrl === "string" || value.moduleUrl instanceof URL)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatExitCode(code: RunnerExitCode) {
  return typeof code === "number" ? String(code) : "unknown";
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isInteractiveTerminal() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

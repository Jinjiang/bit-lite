import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRunner } from "./runner/index.js";
import { ManagedTerminal, RawOutputBuffer } from "bit-lite-terminal";
import type { CliArguments, ComponentRef, WorkspaceRuntime } from "bit-lite-context";
import type { ManagedTerminalItem, ManagedTerminalOptions, TerminalOutputStream } from "bit-lite-terminal";
import type { RunnerExitCode, RunnerMode } from "./runner/index.js";
import type {
  JsonValue,
  VendorConfig,
  VendorData,
  VendorDefinition,
  VendorMessage,
  VendorRunner,
} from "./types/index.js";

export type VendorServiceConfig = {
  vendor: string;
  config: VendorConfig;
};

export type VendorTaskStartOptions = {
  envName: string;
  components: ComponentRef[];
  args: CliArguments;
  context: WorkspaceRuntime;
  serviceConfig: unknown;
};

export type VendorTaskRunResult<RunResult = unknown> = {
  service: string;
  envName: string;
  vendor: string;
  data: RunResult;
};

export type VendorTask<
  RunResult = unknown,
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
> = ManagedTerminalItem & {
  envName: string;
  vendor: VendorDefinition;
  result: Promise<VendorTaskRunResult<RunResult>>;
  exitPromise?: Promise<RunnerExitCode> | undefined;
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
> = {
  serviceId: string;
  label: string;
  title: ManagedTerminalOptions<VendorTask<unknown, EventResult, InputMessage>>["title"];
  canAttach?: ManagedTerminalOptions<VendorTask<unknown, EventResult, InputMessage>>["canAttach"];
  formatResult(result: unknown): string[] | Error;
  formatStoppingMessage?(reason: string): string | undefined;
  isInteractiveTerminal?(): boolean;
};

export type StopVendorTasksOptions = {
  exitTimeoutMs?: number | undefined;
};

type CreateVendorTaskOptions = VendorTaskStartOptions & {
  mode: RunnerMode;
};

type CreateVendorTaskResultOptions<RunResult, EventResult extends JsonValue> = {
  serviceId: string;
  label: string;
  runResult?: {
    formatResult(result: unknown): RunResult | Error;
  };
  eventResult?: {
    formatResult(result: unknown): string[] | Error;
  };
};

type ManagedVendorTask<
  RunResult = unknown,
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
> = VendorTask<RunResult, EventResult, InputMessage> & {
  serviceId: string;
  serviceLabel: string;
  runner: VendorRunner<VendorConfig, RunResult, EventResult, InputMessage>;
  completed: boolean;
  runResult?: CreateVendorTaskResultOptions<RunResult, EventResult>["runResult"];
  eventResult?: CreateVendorTaskResultOptions<RunResult, EventResult>["eventResult"];
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
  const tasks = await createVendorTasks<unknown, EventResult, InputMessage>(
    taskOptions,
    "worker",
    {
      serviceId: options.serviceId,
      label: options.label,
      eventResult: {
        formatResult: options.formatResult,
      },
    }
  );

  if (tasks.length === 0) return tasks;

  const interactive = options.isInteractiveTerminal?.() ?? isInteractiveTerminal();
  let shuttingDown = false;
  let resolveShutdown!: () => void;
  const shutdownPromise = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  const terminal = interactive
    ? new ManagedTerminal<VendorTask<unknown, EventResult, InputMessage>>({
        title: options.title,
        items: tasks,
        canAttach: options.canAttach ?? ((item) => item.canAttach === true),
        onQuit(reason) {
          void shutdown(reason === "ctrl-c" ? "received Ctrl+C" : "quit requested");
        },
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
    void shutdown("received SIGINT");
  };
  const handleSigterm = () => {
    void shutdown("received SIGTERM");
  };

  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);
  terminal?.start();

  try {
    if (interactive) {
      await shutdownPromise;
    } else {
      await Promise.all(tasks.map((task) => waitForWatchTaskSnapshot(task)));
      await shutdown();
    }
  } finally {
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
    for (const unsubscribe of unsubscribers) unsubscribe?.();
    if (!shuttingDown) await shutdown();
  }

  return tasks;

  async function shutdown(reason?: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    terminal?.stop({ clearScreen: true });
    if (interactive && reason) {
      const message = options.formatStoppingMessage?.(reason);
      if (message) process.stdout.write(message);
    }

    await stopVendorTasks(tasks);
    resolveShutdown();
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

  const exitPromises = tasks
    .map((task) => task.exitPromise)
    .filter((exitPromise): exitPromise is NonNullable<VendorTask["exitPromise"]> => exitPromise !== undefined);

  await Promise.race([
    Promise.allSettled(exitPromises),
    new Promise((resolve) => setTimeout(resolve, options.exitTimeoutMs ?? 3000)),
  ]);

  await Promise.allSettled(tasks.map((task) => task.terminate?.()));
}

async function createVendorTasks<
  RunResult = unknown,
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
>(
  taskOptions: VendorTaskStartOptions[],
  mode: RunnerMode,
  resultOptions: CreateVendorTaskResultOptions<RunResult, EventResult>
): Promise<VendorTask<RunResult, EventResult, InputMessage>[]> {
  const tasks: VendorTask<RunResult, EventResult, InputMessage>[] = [];

  try {
    for (const taskOption of taskOptions) {
      tasks.push(
        await createVendorTask<RunResult, EventResult, InputMessage>(
          { ...taskOption, mode },
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
  resultOptions: CreateVendorTaskResultOptions<RunResult, EventResult>
): Promise<VendorTask<RunResult, EventResult, InputMessage>> {
  const serviceConfig = readVendorServiceConfig(options.serviceConfig, resultOptions.serviceId, options.envName);
  const vendor = await loadVendor(
    serviceConfig.vendor,
    resultOptions.serviceId,
    options.envName,
    options.context.workspaceRoot
  );

  return createStartedVendorTask<RunResult, EventResult, InputMessage>(
    options,
    resultOptions,
    vendor,
    serviceConfig.config
  );
}

function createStartedVendorTask<
  RunResult,
  EventResult extends JsonValue,
  InputMessage extends JsonValue,
>(
  options: CreateVendorTaskOptions,
  resultOptions: CreateVendorTaskResultOptions<RunResult, EventResult>,
  vendor: VendorDefinition,
  config: VendorConfig
): VendorTask<RunResult, EventResult, InputMessage> {
  const data: VendorData<VendorConfig> = {
    envName: options.envName,
    components: options.components,
    config,
    args: options.args,
    context: options.context,
  };
  const runner = createRunner<VendorData<VendorConfig>, VendorMessage<EventResult>, InputMessage, RunResult>({
    mode: options.mode,
    target: vendor,
    data,
  });
  const messageListeners = new Set<(message: VendorMessage<EventResult>) => void>();
  const outputListeners = new Set<(stream: TerminalOutputStream, chunk: Buffer) => void>();
  let resolveResult!: (result: VendorTaskRunResult<RunResult>) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<VendorTaskRunResult<RunResult>>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const task: ManagedVendorTask<RunResult, EventResult, InputMessage> = {
    id: `${options.envName}:${vendor.id}`,
    label: `${vendor.label} (${options.envName})`,
    envName: options.envName,
    vendor,
    serviceId: resultOptions.serviceId,
    serviceLabel: resultOptions.label,
    hint: vendor.hint,
    status: "starting",
    details: [],
    rawOutput: new RawOutputBuffer(),
    result,
    runner,
    completed: false,
    runResult: resultOptions.runResult,
    eventResult: resultOptions.eventResult,
    exitPromise: runner.exitPromise,
    resolveResult,
    rejectResult,
    postMessage(message) {
      runner.postMessage(message);
    },
    stop() {
      return runner.stop();
    },
    terminate() {
      return runner.terminate();
    },
    writeInput(chunk) {
      runner.writeInput(chunk);
    },
    canAttach: options.mode === "worker",
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onOutput(listener) {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
  };

  task.exitPromise = runner.exitPromise.then((code) => {
    handleVendorExit(task, code);
    return code;
  });

  runner.onMessage((message) => {
    handleVendorMessage(task, message);
    for (const listener of messageListeners) listener(message);
  });

  runner.onOutput((stream, chunk) => {
    task.rawOutput.append(stream, chunk);
    for (const listener of outputListeners) listener(stream, chunk);
  });

  Promise.resolve(runner.start())
    .then((resultData) => {
      if (resultData !== undefined) {
        recordVendorRunResult(task, resultData);
        return;
      }

      if (task.runResult !== undefined && runner.kind === "inline" && !task.completed) {
        rejectVendorRun(task, new Error(`${task.label} completed without a result`));
      }
    })
    .catch((error) => {
      rejectVendorRun(task, error);
    });

  return task;
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
      service: task.serviceId,
      envName: task.envName,
      vendor: task.vendor.id,
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
    service: task.serviceId,
    envName: task.envName,
    vendor: task.vendor.id,
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

function waitForWatchTaskSnapshot<
  RunResult,
  EventResult extends JsonValue,
  InputMessage extends JsonValue,
>(
  task: VendorTask<RunResult, EventResult, InputMessage>
) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;

    const settle = (error?: unknown) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error instanceof Error ? error : new Error(formatError(error)));
    };

    const hasDetails = () => (task.details?.length ?? 0) > 0;

    unsubscribe = task.onMessage?.(() => {
      if (hasDetails()) settle();
    });

    if (hasDetails()) settle();

    void task.result.catch((error) => settle(error));
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

function readVendorServiceConfig(value: unknown, serviceId: string, envName: string): VendorServiceConfig {
  if (!isRecord(value)) {
    throw new Error(`${serviceId} service config for env "${envName}" must be an object`);
  }

  if (typeof value.vendor !== "string" || value.vendor.length === 0) {
    throw new Error(`${serviceId} service config for env "${envName}" must define a vendor`);
  }

  if (value.config !== undefined && !isRecord(value.config)) {
    throw new Error(`${serviceId} service config for env "${envName}" field "config" must be an object`);
  }

  return {
    vendor: value.vendor,
    config: value.config === undefined ? {} : { ...value.config },
  };
}

async function loadVendor(
  specifier: string,
  serviceId: string,
  envName: string,
  workspaceRoot: string
): Promise<VendorDefinition> {
  let vendorModule: unknown;
  try {
    vendorModule = await import(resolveVendorSpecifier(specifier, workspaceRoot));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to import ${serviceId} vendor "${specifier}" for env "${envName}": ${message}`);
  }

  if (!isRecord(vendorModule) || !isVendorDefinition(vendorModule.meta)) {
    throw new Error(`${serviceId} vendor "${specifier}" for env "${envName}" must export const meta: VendorDefinition`);
  }

  return vendorModule.meta;
}

function resolveVendorSpecifier(specifier: string, workspaceRoot: string) {
  if (isAbsoluteUrl(specifier)) return specifier;

  if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
    const absolutePath = path.isAbsolute(specifier) ? specifier : path.resolve(workspaceRoot, specifier);
    return pathToFileURL(absolutePath).href;
  }

  for (const root of [workspaceRoot, process.cwd()]) {
    try {
      const requireFromRoot = createRequire(path.join(root, "package.json"));
      return pathToFileURL(requireFromRoot.resolve(specifier)).href;
    } catch {
      // Try the next resolution root.
    }
  }

  return specifier;
}

function isAbsoluteUrl(specifier: string) {
  try {
    const url = new URL(specifier);
    return url.protocol.length > 0;
  } catch {
    return false;
  }
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

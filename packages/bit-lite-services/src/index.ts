import { createRunner } from "bit-lite-runner";
import { ManagedTerminal, RawOutputBuffer, writeTerminalOutput } from "bit-lite-terminal";
import type { ManagedTerminalItem, TerminalOutputStream } from "bit-lite-terminal";
import type { RunnerExitCode } from "bit-lite-runner";
import type { JsonValue, VendorConfig, VendorData, VendorMessage, VendorRunner } from "bit-lite-vendors";
import { testService } from "./test-service.js";
import type {
  RunServiceOptions,
  ServiceMode,
  ServiceResult,
  ServiceTaskInput,
  ServiceTaskResult,
} from "./types/index.js";

type ServiceRuntimeState<Config extends VendorConfig = VendorConfig> = ManagedTerminalItem & {
  task: ServiceTaskInput<Config>;
  runner: VendorRunner<Config>;
  result: JsonValue | undefined;
  exitCode: RunnerExitCode;
  exitPromise: Promise<RunnerExitCode>;
  resolveResult?: (() => void) | undefined;
  rejectResult?: ((error: unknown) => void) | undefined;
};

export { testService };
export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  RunServiceOptions,
  RunnerExitCode,
  RunnerMode,
  ServiceCreateTasksInput,
  ServiceDefinition,
  ServiceInput,
  ServiceMode,
  ServiceResult,
  ServiceTaskInput,
  ServiceTaskResult,
  ServiceTerminalOptions,
  ServiceVendorDefinition,
  VendorConfig,
  VendorData,
  VendorDefinition,
  VendorMessage,
  VendorRuntime,
} from "./types/index.js";

export async function runService<Config extends VendorConfig = VendorConfig>(
  options: RunServiceOptions<Config>
): Promise<ServiceResult> {
  const mode = readServiceMode(options.input.args);
  const runnerMode = options.runnerMode ?? (mode === "watch" ? "worker" : "inline");
  const tasks = await options.service.createTasks({
    ...options.input,
    mode,
    vendors: options.vendors ?? [],
  });
  const runtimes = tasks.map((task) => createRuntimeState(task, runnerMode));
  const resultPromises = runtimes.map(
    (runtime) =>
      new Promise<void>((resolve, reject) => {
        runtime.resolveResult = resolve;
        runtime.rejectResult = reject;
      })
  );

  let terminal: ManagedTerminal<ServiceRuntimeState<Config>> | undefined;
  let requestStop: ((reason: string) => void) | undefined;
  const stopPromise = new Promise<string>((resolve) => {
    requestStop = resolve;
  });

  const terminalStdin = options.terminal?.stdin ?? process.stdin;
  const terminalStdout = options.terminal?.stdout ?? process.stdout;
  const terminalEnabled =
    mode === "watch" && (options.terminal?.enabled ?? Boolean(terminalStdin.isTTY && terminalStdout.isTTY));

  if (mode === "watch" && terminalEnabled) {
    terminal = new ManagedTerminal({
      title: () => `${options.service.label} (${runnerMode} runner)`,
      items: runtimes,
      instructions: "Use Up/Down and Enter for raw output. Press q or Ctrl+C to stop.",
      stdin: options.terminal?.stdin,
      stdout: options.terminal?.stdout,
      stderr: options.terminal?.stderr,
      canAttach: () => runnerMode === "worker",
      onQuit(reason) {
        requestStop?.(reason === "ctrl-c" ? "received Ctrl+C" : "quit requested");
      },
    });
  }

  for (const runtime of runtimes) {
    wireRuntime(runtime, mode, terminal, options.service.formatDetails);
  }

  terminal?.start();

  for (const runtime of runtimes) {
    Promise.resolve(runtime.runner.start()).catch((error) => {
      handleMessage(runtime, { type: "error", message: formatError(error) }, terminal, options.service.formatDetails);
    });
  }

  if (mode === "watch") {
    const cleanupSignals = bindStopSignals((reason) => requestStop?.(reason));
    const timer = setAutoStopTimer(options.terminal?.autoStopMs, (reason) => requestStop?.(reason));
    const reason = await stopPromise;
    cleanupSignals();
    if (timer) clearTimeout(timer);

    await stopRuntimes(runtimes);
    terminal?.stop({ clearScreen: terminalEnabled });

    if (!terminalEnabled) {
      process.stdout.write(`Stopped ${options.service.label}: ${reason}\n`);
    }

    return createServiceResult(options.service.id, mode, "stopped", runtimes);
  }

  await Promise.all(resultPromises);
  await stopRuntimes(runtimes);

  return createServiceResult(options.service.id, mode, "success", runtimes);
}

function createRuntimeState<Config extends VendorConfig>(
  task: ServiceTaskInput<Config>,
  runnerMode: "inline" | "worker"
): ServiceRuntimeState<Config> {
  const runner = createRunner<VendorData<Config>, VendorMessage>({
    mode: runnerMode,
    target: task.vendor,
    data: task.data,
  });

  const state: ServiceRuntimeState<Config> = {
    id: task.id,
    label: task.label,
    status: "starting",
    details: [],
    rawOutput: new RawOutputBuffer(),
    writeInput: (chunk) => runner.writeInput(chunk),
    canAttach: runnerMode === "worker",
    task,
    runner,
    result: undefined,
    exitCode: undefined,
    exitPromise: runner.exitPromise,
  };

  if (task.vendor.hint) state.hint = task.vendor.hint;
  return state;
}

function wireRuntime<Config extends VendorConfig>(
  runtime: ServiceRuntimeState<Config>,
  mode: ServiceMode,
  terminal: ManagedTerminal<ServiceRuntimeState<Config>> | undefined,
  formatDetails: ((result: JsonValue) => string[]) | undefined
) {
  runtime.exitPromise = runtime.runner.exitPromise.then((code) => {
    runtime.exitCode = code;
    if (code !== 0 && runtime.result === undefined) {
      runtime.rejectResult?.(new Error(`${runtime.label} exited with code ${formatExitCode(code)}`));
    }
    return code;
  });

  runtime.runner.onMessage((message) => {
    handleMessage(runtime, message, terminal, formatDetails);
  });

  runtime.runner.onOutput((stream, chunk) => {
    appendOutput(runtime, stream, chunk, terminal, mode);
  });
}

function handleMessage<Config extends VendorConfig>(
  runtime: ServiceRuntimeState<Config>,
  message: VendorMessage,
  terminal: ManagedTerminal<ServiceRuntimeState<Config>> | undefined,
  formatDetails: ((result: JsonValue) => string[]) | undefined
) {
  if (message.type === "ready") {
    runtime.status = "ready";
    terminal?.scheduleRender();
    return;
  }

  if (message.type === "status") {
    runtime.status = message.status;
    terminal?.scheduleRender();
    return;
  }

  if (message.type === "error") {
    runtime.status = "error";
    runtime.rejectResult?.(new Error(message.message));
    terminal?.scheduleRender();
    return;
  }

  runtime.result = message.data;
  runtime.details = formatDetails?.(message.data) ?? [];
  runtime.resolveResult?.();
  terminal?.scheduleRender();
}

async function stopRuntimes(runtimes: Array<ServiceRuntimeState>) {
  for (const runtime of runtimes) {
    await runtime.runner.stop();
  }

  await Promise.race([
    Promise.allSettled(runtimes.map((runtime) => runtime.exitPromise)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);

  await Promise.allSettled(runtimes.map((runtime) => runtime.runner.terminate()));
}

function appendOutput<Config extends VendorConfig>(
  runtime: ServiceRuntimeState<Config>,
  stream: TerminalOutputStream,
  chunk: Buffer,
  terminal: ManagedTerminal<ServiceRuntimeState<Config>> | undefined,
  mode: ServiceMode
) {
  if (terminal) {
    terminal.appendOutput(runtime, stream, chunk);
    return;
  }

  runtime.rawOutput.append(stream, chunk);
  if (mode === "run") writeTerminalOutput(stream, chunk);
}

function createServiceResult(
  serviceId: string,
  mode: ServiceMode,
  status: string,
  runtimes: Array<ServiceRuntimeState>
): ServiceResult {
  return {
    serviceId,
    mode,
    status,
    results: runtimes.map((runtime): ServiceTaskResult => {
      return {
        taskId: runtime.task.id,
        vendorId: runtime.task.vendor.id,
        data: runtime.result,
        exitCode: runtime.exitCode,
      };
    }),
  };
}

function readServiceMode(args: { options: Record<string, unknown> }): ServiceMode {
  return args.options.watch === true ? "watch" : "run";
}

function bindStopSignals(onStop: (reason: string) => void) {
  const onSigint = () => onStop("received SIGINT");
  const onSigterm = () => onStop("received SIGTERM");

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  return () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };
}

function setAutoStopTimer(autoStopMs: number | undefined, onStop: (reason: string) => void) {
  if (!Number.isFinite(autoStopMs) || !autoStopMs || autoStopMs <= 0) return undefined;

  const timer = setTimeout(() => {
    onStop(`auto stop after ${autoStopMs}ms`);
  }, autoStopMs);
  timer.unref();
  return timer;
}

function formatExitCode(code: RunnerExitCode) {
  return typeof code === "number" ? String(code) : "unknown";
}

function formatError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

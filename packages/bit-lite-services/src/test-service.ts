import type { ComponentRef } from "bit-lite-context";
import { createRunner } from "bit-lite-runner";
import type { RunnerExitCode, RunnerMode } from "bit-lite-runner";
import { ManagedTerminal, RawOutputBuffer } from "bit-lite-terminal";
import type { TerminalOutputStream } from "bit-lite-terminal";
import type { TestServiceResult, VendorRunner } from "bit-lite-vendors";
import type {
  ServiceDefinition,
  ServiceRunInput,
  VendorConfig,
  VendorData,
  VendorDefinition,
  VendorMessage,
} from "./types/index.js";

const serviceId = "test";

type ConfiguredVendorRun<Config extends VendorConfig = VendorConfig> = {
  id: string;
  label: string;
  vendor: VendorDefinition<Config>;
  data: VendorData<Config>;
};

type VendorRunState<Config extends VendorConfig = VendorConfig> = {
  id: string;
  label: string;
  hint: string;
  status: string;
  details: string[];
  result: TestServiceResult | undefined;
  rawOutput: RawOutputBuffer;
  writeInput(chunk: Buffer | string): void;
  canAttach: boolean;
  runner: VendorRunner<Config, TestServiceResult>;
  completed: boolean;
  exitPromise: Promise<RunnerExitCode>;
  resolveCompletion?: (() => void) | undefined;
  rejectCompletion?: ((error: unknown) => void) | undefined;
};

export const testService: ServiceDefinition = {
  id: serviceId,
  label: "Test",
  async run(input) {
    const vendorRuns = await createConfiguredVendorRuns(input);
    if (input.args.options.watch === true) {
      await runWatchVendors(vendorRuns);
      return;
    }

    await runOnceVendors(vendorRuns);
  },
};

async function createConfiguredVendorRuns(input: ServiceRunInput) {
  const selectedComponentIds = new Set(input.components.map((component) => component.id));
  const vendorRuns: ConfiguredVendorRun[] = [];

  for (const group of input.context.groups) {
    const serviceConfig = readServiceConfig(group.env.services[serviceId]);
    if (!serviceConfig) continue;

    const vendor = await loadVendor(serviceConfig.vendor, group.envName);

    const components = group.components.filter((component) => selectedComponentIds.has(component.id));
    if (components.length === 0) continue;

    vendorRuns.push(
      createVendorRun(input, vendor, components, {
        id: `${group.envName}:${vendor.id}`,
        label: `${vendor.label} (${group.envName})`,
        config: serviceConfig.config,
      })
    );
  }

  return vendorRuns;
}

function createVendorRun(
  input: ServiceRunInput,
  vendor: VendorDefinition,
  components: ComponentRef[],
  options: { id?: string; label?: string; config?: VendorConfig } = {}
): ConfiguredVendorRun {
  const config = {
    ...(vendor.config ?? {}),
    ...(options.config ?? {}),
  } satisfies VendorConfig;

  return {
    id: options.id ?? vendor.id,
    label: options.label ?? vendor.label,
    vendor,
    data: {
      components,
      config,
      args: input.args,
      context: input.context,
    },
  };
}

async function runOnceVendors(vendorRuns: ConfiguredVendorRun[]) {
  const states = vendorRuns.map((vendorRun) => createVendorRunState(vendorRun, "inline"));
  const completionPromises = states.map(
    (state) =>
      new Promise<void>((resolve, reject) => {
        state.resolveCompletion = resolve;
        state.rejectCompletion = reject;
      })
  );

  for (const state of states) {
    wireRunOnceVendorRun(state);
  }

  for (const state of states) {
    Promise.resolve(state.runner.start())
      .then((data) => {
        if (data !== undefined) {
          recordVendorResult(state, data);
          completeVendorRun(state);
        }
      })
      .catch((error) => {
        rejectVendorRun(state, error);
      });
  }

  try {
    await Promise.all(completionPromises);
    printTestResults(states);
  } finally {
    await stopVendorRuns(states);
  }
}

async function runWatchVendors(vendorRuns: ConfiguredVendorRun[]) {
  const states = vendorRuns.map((vendorRun) => createVendorRunState(vendorRun, "worker"));
  if (states.length === 0) return;

  const interactive = isInteractiveTerminal();
  let shuttingDown = false;
  let resolveShutdown!: () => void;
  const shutdownPromise = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  const completionPromises = interactive
    ? []
    : states.map(
        (state) =>
          new Promise<void>((resolve, reject) => {
            state.resolveCompletion = resolve;
            state.rejectCompletion = reject;
          })
      );

  const terminal = interactive
    ? new ManagedTerminal<VendorRunState>({
        title: "bit-lite test --watch",
        items: states,
        canAttach: (item) => item.canAttach === true,
        onQuit(reason) {
          void shutdown(reason === "ctrl-c" ? "received Ctrl+C" : "quit requested");
        },
      })
    : undefined;

  const handleSigint = () => {
    void shutdown("received SIGINT");
  };
  const handleSigterm = () => {
    void shutdown("received SIGTERM");
  };

  for (const state of states) {
    wireWatchVendorRun(state, {
      completeOnResult: !interactive,
      terminal,
      isShuttingDown: () => shuttingDown,
    });
  }

  for (const state of states) {
    Promise.resolve(state.runner.start()).catch((error) => {
      handleWatchVendorMessage(state, { type: "error", message: formatError(error) }, terminal, !interactive);
    });
  }

  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);
  terminal?.start();

  try {
    if (interactive) {
      await shutdownPromise;
    } else {
      await Promise.all(completionPromises);
      await shutdown();
    }
  } finally {
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
    if (!shuttingDown) await shutdown();
  }

  async function shutdown(reason?: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    terminal?.stop({ clearScreen: true });
    if (interactive && reason) process.stdout.write(`Stopping bit-lite test (${reason})...\n`);

    await stopVendorRuns(states);
    resolveShutdown();
  }
}

function createVendorRunState<Config extends VendorConfig>(
  vendorRun: ConfiguredVendorRun<Config>,
  mode: RunnerMode
): VendorRunState<Config> {
  const runner = createRunner<VendorData<Config>, VendorMessage, never, TestServiceResult>({
    mode,
    target: vendorRun.vendor,
    data: vendorRun.data,
  });

  return {
    id: vendorRun.id,
    label: vendorRun.label,
    hint: vendorRun.vendor.hint,
    status: "starting",
    details: [],
    result: undefined,
    rawOutput: new RawOutputBuffer(),
    runner,
    completed: false,
    exitPromise: runner.exitPromise,
    writeInput(chunk) {
      runner.writeInput(chunk);
    },
    canAttach: mode === "worker",
  };
}

function wireRunOnceVendorRun<Config extends VendorConfig>(state: VendorRunState<Config>) {
  state.exitPromise = state.runner.exitPromise.then((code) => {
    if (code !== 0 && !state.completed) {
      state.rejectCompletion?.(new Error(`${state.label} exited with code ${formatExitCode(code)}`));
    }
    return code;
  });

  state.runner.onMessage((message) => {
    handleRunOnceVendorMessage(state, message);
  });
}

function wireWatchVendorRun<Config extends VendorConfig>(
  state: VendorRunState<Config>,
  options: {
    completeOnResult: boolean;
    terminal: ManagedTerminal<VendorRunState> | undefined;
    isShuttingDown(): boolean;
  }
) {
  state.exitPromise = state.runner.exitPromise.then((code) => {
    state.status = code === 0 || options.isShuttingDown() ? "stopped" : `exited ${formatExitCode(code)}`;

    if (code !== 0 && !state.completed) {
      state.rejectCompletion?.(new Error(`${state.label} exited with code ${formatExitCode(code)}`));
    }

    options.terminal?.scheduleRender();
    return code;
  });

  state.runner.onMessage((message) => {
    handleWatchVendorMessage(state, message, options.terminal, options.completeOnResult);
  });

  state.runner.onOutput((stream, chunk) => {
    appendOutput(state, stream, chunk, options.terminal);
  });
}

function handleRunOnceVendorMessage<Config extends VendorConfig>(state: VendorRunState<Config>, message: VendorMessage) {
  if (message.type === "ready" || message.type === "status") return;

  if (message.type === "error") {
    rejectVendorRun(state, new Error(message.message));
    return;
  }

  recordVendorResult(state, message.data);
  completeVendorRun(state);
}

function handleWatchVendorMessage<Config extends VendorConfig>(
  state: VendorRunState<Config>,
  message: VendorMessage,
  terminal: ManagedTerminal<VendorRunState> | undefined,
  completeOnResult: boolean
) {
  if (message.type === "ready") {
    state.status = "ready";
    terminal?.scheduleRender();
    return;
  }

  if (message.type === "status") {
    state.status = message.status;
    terminal?.scheduleRender();
    return;
  }

  if (message.type === "error") {
    state.status = "error";
    rejectVendorRun(state, new Error(message.message));
    terminal?.scheduleRender();
    return;
  }

  recordVendorResult(state, message.data);
  terminal?.scheduleRender();

  if (completeOnResult) completeVendorRun(state);
}

function recordVendorResult<Config extends VendorConfig>(state: VendorRunState<Config>, result: unknown) {
  if (!isTestServiceResult(result)) return;

  state.result = result;
  state.details = formatTestResultDetails(result);
}

function completeVendorRun<Config extends VendorConfig>(state: VendorRunState<Config>) {
  if (state.completed) return;
  state.completed = true;
  state.resolveCompletion?.();
}

function rejectVendorRun<Config extends VendorConfig>(state: VendorRunState<Config>, error: unknown) {
  state.rejectCompletion?.(error instanceof Error ? error : new Error(formatError(error)));
}

async function stopVendorRuns(states: Array<VendorRunState>) {
  for (const state of states) {
    await state.runner.stop();
  }

  await Promise.race([
    Promise.allSettled(states.map((state) => state.exitPromise)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);

  await Promise.allSettled(states.map((state) => state.runner.terminate()));
}

function appendOutput<Config extends VendorConfig>(
  state: VendorRunState<Config>,
  stream: TerminalOutputStream,
  chunk: Buffer,
  terminal: ManagedTerminal<VendorRunState> | undefined
) {
  if (terminal) {
    terminal.appendOutput(state, stream, chunk);
    return;
  }

  state.rawOutput.append(stream, chunk);
}

function printTestResults(states: Array<VendorRunState>) {
  if (states.length === 0) return;

  console.log("Test results:");
  for (const state of states) {
    const details = formatTestResultDetails(state.result);
    console.log(`- ${state.label}: ${details.length > 0 ? details.join(" ") : "completed"}`);
  }
}

function formatTestResultDetails(result: TestServiceResult | undefined) {
  return result ? [result.summary] : [];
}

function isTestServiceResult(value: unknown): value is TestServiceResult {
  return (
    isRecord(value) &&
    value.service === "test" &&
    typeof value.vendor === "string" &&
    (value.mode === "run" || value.mode === "watch") &&
    typeof value.run === "number" &&
    Array.isArray(value.componentIds) &&
    value.componentIds.every((componentId) => typeof componentId === "string") &&
    isRecord(value.args) &&
    isRecord(value.config) &&
    typeof value.total === "number" &&
    typeof value.passed === "number" &&
    typeof value.failed === "number" &&
    typeof value.summary === "string"
  );
}

function isInteractiveTerminal() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

function readServiceConfig(value: unknown): { vendor: string; config: VendorConfig } | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.vendor !== "string" || value.vendor.length === 0) return undefined;

  const vendor = value.vendor;
  const config = isRecord(value.config) ? value.config : {};
  return { vendor, config };
}

async function loadVendor(specifier: string, envName: string): Promise<VendorDefinition> {
  let vendorModule: unknown;
  try {
    vendorModule = await import(specifier);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to import ${serviceId} vendor "${specifier}" for env "${envName}": ${message}`);
  }

  if (!isRecord(vendorModule) || !isVendorDefinition(vendorModule.meta)) {
    throw new Error(`${serviceId} vendor "${specifier}" for env "${envName}" must export const meta: VendorDefinition`);
  }

  return vendorModule.meta;
}

function isVendorDefinition(value: unknown): value is VendorDefinition {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
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
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

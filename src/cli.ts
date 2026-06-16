import path from "node:path";
import { BitLiteError } from "./errors.js";
import { isOutputPayload, type ServiceRunReporter } from "./output-reporter.js";
import { matchPattern } from "./patterns.js";
import { createPreviewRunReporter } from "./preview-reporter.js";
import { runService } from "./runtime.js";
import { runStart } from "./start.js";
import { createStartRunReporter } from "./start-reporter.js";
import { createTestRunReporter } from "./test-reporter.js";
import { loadWorkspace } from "./workspace.js";
import type { ServiceResult, WorkspaceRuntime } from "./types.js";

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.help || !parsed.command) {
    printUsage();
    return 0;
  }

  try {
    const loadedWorkspace = await loadWorkspace(parsed.workspaceRoot);
    const workspace = parsed.filterPattern ? filterWorkspace(loadedWorkspace, parsed.filterPattern) : loadedWorkspace;
    switch (parsed.command) {
      case "components":
        printComponents(workspace.components);
        return 0;
      case "envs":
        printEnvs(workspace.envs);
        return 0;
      case "start": {
        return await runStartCli(workspace);
      }
      case "run": {
        if (!parsed.serviceName) throw new BitLiteError("run requires a service name");
        return await runServiceCli(workspace, parsed.serviceName, parsed.serviceArgs);
      }
      default:
        throw new BitLiteError(`unknown command "${parsed.command}"`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}

async function runStartCli(workspace: WorkspaceRuntime) {
  const controller = new AbortController();
  const reporter = createStartRunReporter(workspace);
  const cleanupControls = installRunControls(controller, (chunk) => reporter.onInput?.(chunk));
  try {
    const results = await runStart(workspace, {
      signal: controller.signal,
      reporter,
    });
    if (results.every(({ result }) => result.ok)) {
      await waitForAbort(controller.signal);
      const { stopPreviewRuntime } = await import("./preview.js");
      await stopPreviewRuntime();
    }
    reporter.flush();
    reporter.close?.();
    printServiceResults("start", results);
    return results.every(({ result }) => result.ok) ? 0 : 1;
  } finally {
    cleanupControls();
    reporter.close?.();
  }
}

type ParsedArgs = {
  command: string | undefined;
  serviceName: string | undefined;
  serviceArgs: string[];
  workspaceRoot: string;
  filterPattern: string | undefined;
  help: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const remaining: string[] = [];
  let workspaceRoot = process.cwd();
  let filterPattern: string | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--workspace" || arg === "-w") {
      const value = argv[index + 1];
      if (!value) throw new BitLiteError("--workspace requires a path");
      workspaceRoot = path.resolve(value);
      index += 1;
    } else if (arg === "--filter") {
      const value = argv[index + 1];
      if (!value) throw new BitLiteError("--filter requires a pattern");
      filterPattern = value;
      index += 1;
    } else if (arg) {
      remaining.push(arg);
    }
  }

  return {
    command: remaining[0],
    serviceName: remaining[1],
    serviceArgs: remaining.slice(2),
    workspaceRoot,
    filterPattern,
    help,
  };
}

function printUsage() {
  console.log(`bit-lite

Usage:
  bit-lite components [--workspace <dir>] [--filter <pattern>]
  bit-lite envs [--workspace <dir>]
  bit-lite start [--workspace <dir>] [--filter <pattern>]
  bit-lite run <service> [--workspace <dir>] [--filter <pattern>] [...service args]
`);
}

function filterWorkspace(workspace: WorkspaceRuntime, pattern: string): WorkspaceRuntime {
  const components = workspace.components.filter((component) => matchPattern(component.id, pattern));
  const componentIds = new Set(components.map((component) => component.id));
  const groups = workspace.groups
    .map((group) => ({
      ...group,
      components: group.components.filter((component) => componentIds.has(component.id)),
    }))
    .filter((group) => group.components.length > 0);

  return {
    ...workspace,
    components,
    groups,
  };
}

type PrintableServiceResult = {
  envName: string;
  result: ServiceResult;
};

async function runServiceCli(workspace: WorkspaceRuntime, serviceName: string, args: string[]) {
  const controller = new AbortController();
  const reporter = createRunReporter(workspace, serviceName, args);
  const cleanupControls = reporter?.onInput ? installRunControls(controller, (chunk) => reporter.onInput?.(chunk)) : () => {};
  try {
    const results = await runService(workspace, serviceName, {
      args,
      execution: "parallel",
      signal: controller.signal,
      onEvent: reporter?.onEvent ?? writeServiceEventToConsole,
      ...(reporter?.onTask ? { onTask: reporter.onTask } : {}),
    });
    reporter?.flush();
    printServiceResults(serviceName, results);
    if (serviceName === "preview" && results.every(({ result }) => result.ok)) {
      await waitForAbort(controller.signal);
      const { stopPreviewRuntime } = await import("./preview.js");
      await stopPreviewRuntime();
    }
    return results.every(({ result }) => result.ok) ? 0 : 1;
  } finally {
    cleanupControls();
    reporter?.close?.();
  }
}

function waitForAbort(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function createRunReporter(workspace: WorkspaceRuntime, serviceName: string, args: string[]): ServiceRunReporter | undefined {
  if (serviceName === "test") return createTestRunReporter(workspace, args.includes("--watch"));
  if (serviceName === "preview") return createPreviewRunReporter(workspace);
  return undefined;
}

function printServiceResults(serviceName: string, results: PrintableServiceResult[]) {
  results.forEach(({ envName, result }) => {
    if (result.message) console.log(result.message);
    console.log(`${result.ok ? "ok" : "failed"} ${serviceName} (${envName})`);
  });
}

function printComponents(components: Array<{ id: string; rootDir: string; envName: string }>) {
  if (components.length === 0) {
    console.log("no components discovered");
    return;
  }
  components.forEach((component) => {
    console.log(`${component.id}  ${component.envName}  ${component.rootDir}`);
  });
}

function printEnvs(envs: Record<string, { services: Record<string, unknown> }>) {
  Object.entries(envs)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([name, env]) => {
      const services = Object.keys(env.services);
      console.log(`${name}  ${services.length ? services.join(", ") : "(no services)"}`);
    });
}

function writeServiceEventToConsole(type: string, payload: unknown) {
  if (type !== "output" || !isOutputPayload(payload)) return;
  const target = payload.stream === "stderr" ? process.stderr : process.stdout;
  target.write(payload.chunk);
}

function installRunControls(controller: AbortController, onInput?: (chunk: Buffer) => boolean | undefined) {
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
  };
  const onData = (chunk: Buffer) => {
    const value = chunk.toString("utf8");
    const shouldStop = onInput?.(chunk) ?? false;
    if (shouldStop || (!onInput && value.includes("q")) || value.includes("\u0003")) stop();
  };
  const onSigint = () => stop();

  process.on("SIGINT", onSigint);
  process.stdin.on("data", onData);
  process.stdin.resume();
  const wasRaw = process.stdin.isTTY ? process.stdin.isRaw : false;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  return () => {
    process.off("SIGINT", onSigint);
    process.stdin.off("data", onData);
    if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
  };
}

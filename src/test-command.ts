import { BitLiteError } from "./errors.js";
import { createServiceHost } from "./runtime.js";
import { loadServicesForEnv } from "./services.js";
import type { ServiceCommandHandler } from "./service-command.js";
import type { ServiceRunResult } from "./runtime.js";
import type { ComponentRef, ServiceEvent, ServiceOutputMode, WorkspaceRuntime } from "./types.js";

type TestRunnableGroup = {
  envName: string;
  components: ComponentRef[];
  runnable: Awaited<ReturnType<typeof loadServicesForEnv>>[number];
};

export type TestWatchEvent =
  | {
      type: "start";
      envName: string;
    }
  | {
      type: "output";
      envName: string;
      stream: "stdout" | "stderr";
      chunk: string;
    }
  | {
      type: "service-event";
      envName: string;
      event: ServiceEvent;
    }
  | {
      type: "exit";
      envName: string;
      result: ServiceRunResult;
    }
  | {
      type: "error";
      envName: string;
      error: unknown;
    };

export type TestWatchOptions = {
  outputMode: ServiceOutputMode;
  signal: AbortSignal;
  onEvent?: (event: TestWatchEvent) => void;
};

export const testCommandHandler: ServiceCommandHandler = {
  async run({ workspace, args }) {
    const options = parseTestCommandArgs(args);
    if (options.watch) return runTestWatch(workspace);
    return runTestOnce(workspace);
  },
};

export function runTestOnce(workspace: WorkspaceRuntime): Promise<ServiceRunResult[]> {
  return runServiceLikeTest(workspace, {
    watch: false,
    outputMode: "inherit",
  });
}

export async function runTestWatch(workspace: WorkspaceRuntime): Promise<ServiceRunResult[]> {
  const runnableGroups = await findTestRunnableGroups(workspace);
  console.log(`watching tests for ${runnableGroups.map((group) => group.envName).join(", ")}`);
  console.log("press q to quit");
  const controller = new AbortController();
  const cleanupControls = installWatchControls(controller);
  try {
    return await startTestWatchersForGroups(workspace, runnableGroups, {
      outputMode: "inherit",
      signal: controller.signal,
    });
  } finally {
    cleanupControls();
  }
}

export async function startTestWatchers(
  workspace: WorkspaceRuntime,
  options: TestWatchOptions
): Promise<ServiceRunResult[]> {
  const runnableGroups = await findTestRunnableGroups(workspace);
  return startTestWatchersForGroups(workspace, runnableGroups, options);
}

function startTestWatchersForGroups(
  workspace: WorkspaceRuntime,
  runnableGroups: TestRunnableGroup[],
  options: TestWatchOptions
): Promise<ServiceRunResult[]> {
  return Promise.all(runnableGroups.map((group) => runTestService(workspace, group, { ...options, watch: true })));
}

async function runServiceLikeTest(
  workspace: WorkspaceRuntime,
  options: {
    watch: boolean;
    outputMode: ServiceOutputMode;
    signal?: AbortSignal;
    onEvent?: (event: TestWatchEvent) => void;
  }
): Promise<ServiceRunResult[]> {
  const runnableGroups = await findTestRunnableGroups(workspace);
  return Promise.all(runnableGroups.map((group) => runTestService(workspace, group, options)));
}

async function findTestRunnableGroups(workspace: WorkspaceRuntime): Promise<TestRunnableGroup[]> {
  const runnableGroups: TestRunnableGroup[] = [];
  for (const group of workspace.groups) {
    const services = await loadServicesForEnv(workspace.workspaceRoot, group.env.services);
    const runnable = services.find(({ serviceRef, service }) => serviceRef === "test" || service.name === "test");
    if (!runnable) continue;
    runnableGroups.push({
      envName: group.envName,
      components: group.components,
      runnable,
    });
  }
  if (runnableGroups.length === 0) {
    throw new BitLiteError('service "test" is not configured for any discovered env');
  }
  return runnableGroups;
}

async function runTestService(
  workspace: WorkspaceRuntime,
  group: TestRunnableGroup,
  options: {
    watch: boolean;
    outputMode: ServiceOutputMode;
    signal?: AbortSignal;
    onEvent?: (event: TestWatchEvent) => void;
  }
): Promise<ServiceRunResult> {
  options.onEvent?.({ type: "start", envName: group.envName });
  try {
    const result = await group.runnable.service.run({
      workspaceRoot: workspace.workspaceRoot,
      envName: group.envName,
      components: group.components,
      serviceConfig: {
        ...readObjectConfig(group.runnable.config),
        ...(options.watch ? { watch: true } : {}),
      },
      host: createServiceHost({
        ...(options.signal ? { signal: options.signal } : {}),
        outputMode: options.outputMode,
        onEvent: (event) => {
          options.onEvent?.({ type: "service-event", envName: group.envName, event });
          if (event.type === "output") {
            options.onEvent?.({
              type: "output",
              envName: group.envName,
              stream: event.stream,
              chunk: event.chunk,
            });
          }
        },
      }),
    });
    const runResult = {
      envName: group.envName,
      serviceName: group.runnable.service.name,
      result,
    };
    options.onEvent?.({ type: "exit", envName: group.envName, result: runResult });
    return runResult;
  } catch (error) {
    options.onEvent?.({ type: "error", envName: group.envName, error });
    throw error;
  }
}

function installWatchControls(controller: AbortController) {
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    console.log("\nstopping test watchers");
    controller.abort();
  };
  const onData = (chunk: Buffer) => {
    const value = chunk.toString("utf8");
    if (value.includes("q") || value.includes("\u0003")) stop();
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

function parseTestCommandArgs(args: string[]) {
  let watch = false;
  for (const arg of args) {
    if (arg === "--watch") {
      watch = true;
      continue;
    }
    throw new BitLiteError(`unknown test argument "${arg}"`);
  }
  return { watch };
}

function readObjectConfig(config: unknown): Record<string, unknown> {
  if (typeof config === "object" && config !== null && !Array.isArray(config)) return config as Record<string, unknown>;
  return {};
}

import { BitLiteError } from "./errors.js";
import { runService } from "./runtime.js";
import type {
  ServiceCommandHandler,
  ServiceRunResult,
  WorkspaceRuntime,
} from "./types.js";

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
      eventType: string;
      payload: unknown;
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
  return runService(workspace, "test", {
    args: { watch: false },
    execution: "parallel",
    onEvent: writeServiceEventToConsole,
  });
}

export async function runTestWatch(workspace: WorkspaceRuntime): Promise<ServiceRunResult[]> {
  const controller = new AbortController();
  const envNames = workspace.groups.map((group) => group.envName).sort();
  console.log(`watching tests for ${envNames.join(", ")}`);
  console.log("press q to quit");
  const cleanupControls = installWatchControls(controller);
  try {
    return await startTestWatchers(workspace, {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "output") {
          writeOutputPayload(event.stream, event.chunk);
        }
      },
    });
  } finally {
    cleanupControls();
  }
}

export async function startTestWatchers(
  workspace: WorkspaceRuntime,
  options: TestWatchOptions
): Promise<ServiceRunResult[]> {
  workspace.groups.forEach((group) => options.onEvent?.({ type: "start", envName: group.envName }));
  try {
    const results = await runService(workspace, "test", {
      args: { watch: true },
      execution: "parallel",
      signal: options.signal,
      onEvent: (type, payload, context) => {
        options.onEvent?.({ type: "service-event", envName: context.envName, eventType: type, payload });
        if (type === "output" && isOutputPayload(payload)) {
          options.onEvent?.({
            type: "output",
            envName: context.envName,
            stream: payload.stream,
            chunk: payload.chunk,
          });
        }
      },
    });
    results.forEach((result) => options.onEvent?.({ type: "exit", envName: result.envName, result }));
    return results;
  } catch (error) {
    workspace.groups.forEach((group) => options.onEvent?.({ type: "error", envName: group.envName, error }));
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

function writeServiceEventToConsole(type: string, payload: unknown) {
  if (type === "output" && isOutputPayload(payload)) {
    writeOutputPayload(payload.stream, payload.chunk);
  }
}

function writeOutputPayload(stream: "stdout" | "stderr", chunk: string) {
  const target = stream === "stderr" ? process.stderr : process.stdout;
  target.write(chunk);
}

function isOutputPayload(value: unknown): value is { stream: "stdout" | "stderr"; chunk: string } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { stream?: unknown; chunk?: unknown };
  return (candidate.stream === "stdout" || candidate.stream === "stderr") && typeof candidate.chunk === "string";
}

import { runService } from "./runtime.js";
import type { ServiceRunEventContext } from "./runtime.js";
import type {
  ServiceRunResult,
  ServiceTask,
  WorkspaceRuntime,
} from "./types/index.js";

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
  onTask?: (task: ServiceTask, context: ServiceRunEventContext) => void;
};

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
      ...(options.onTask ? { onTask: options.onTask } : {}),
    });
    results.forEach((result) => options.onEvent?.({ type: "exit", envName: result.envName, result }));
    return results;
  } catch (error) {
    workspace.groups.forEach((group) => options.onEvent?.({ type: "error", envName: group.envName, error }));
    throw error;
  }
}

function isOutputPayload(value: unknown): value is { stream: "stdout" | "stderr"; chunk: string } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { stream?: unknown; chunk?: unknown };
  return (candidate.stream === "stdout" || candidate.stream === "stderr") && typeof candidate.chunk === "string";
}

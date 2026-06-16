import { runService } from "./runtime.js";
import { setPreviewRuntimeMode, startTestWatchersForWorkspace } from "./preview.js";
import type { ServiceRunReporter } from "./reporter/output-reporter.js";
import type { ServiceRunResult, WorkspaceRuntime } from "./types/index.js";

export type StartOptions = {
  signal?: AbortSignal;
  reporter?: ServiceRunReporter;
};

export async function runStart(workspace: WorkspaceRuntime, options: StartOptions = {}): Promise<ServiceRunResult[]> {
  setPreviewRuntimeMode("start");
  const results = await runService(workspace, "preview", {
    execution: "parallel",
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.reporter?.onEvent ? { onEvent: options.reporter.onEvent } : {}),
    ...(options.reporter?.onTask ? { onTask: options.reporter.onTask } : {}),
  });
  await startTestWatchersForWorkspace(workspace, options.reporter);
  return results;
}

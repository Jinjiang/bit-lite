import { isOutputPayload, type ServiceRunReporter } from "../reporter/output-reporter.js";
import { resolveRunnableGroups, runRunnableGroups } from "../runtime.js";
import type { ServiceResult, WorkspaceRuntime } from "../types/index.js";

export type PrintableServiceResult = {
  envName: string;
  result: ServiceResult;
};

export async function runServiceGroupsCommand(
  workspace: WorkspaceRuntime,
  serviceName: string,
  args: unknown,
  reporter?: ServiceRunReporter
) {
  const controller = new AbortController();
  const cleanupControls = reporter?.onInput ? installRunControls(controller, (chunk) => reporter.onInput?.(chunk)) : () => {};
  try {
    const runnableGroups = await resolveRunnableGroups(workspace, serviceName);
    const results = await runRunnableGroups(runnableGroups, {
      workspaceRoot: workspace.workspaceRoot,
      args,
      execution: "parallel",
      signal: controller.signal,
      onEvent: reporter?.onEvent ?? writeServiceEventToConsole,
      ...(reporter?.onTask ? { onTask: reporter.onTask } : {}),
    });
    reporter?.flush();
    printServiceResults(serviceName, results);
    return results.every(({ result }) => result.ok) ? 0 : 1;
  } finally {
    cleanupControls();
    reporter?.close?.();
  }
}

export function waitForAbort(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

export function installRunControls(controller: AbortController, onInput?: (chunk: Buffer) => boolean | undefined) {
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

export function printServiceResults(serviceName: string, results: PrintableServiceResult[]) {
  results.forEach(({ envName, result }) => {
    if (result.message) console.log(result.message);
    console.log(`${result.ok ? "ok" : "failed"} ${serviceName} (${envName})`);
  });
}

export function writeServiceEventToConsole(type: string, payload: unknown) {
  if (type !== "output" || !isOutputPayload(payload)) return;
  const target = payload.stream === "stderr" ? process.stderr : process.stdout;
  target.write(payload.chunk);
}

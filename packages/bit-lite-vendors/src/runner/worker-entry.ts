import { parentPort, workerData } from "node:worker_threads";
import { installWorkerTtyShim, isTerminalResizeMessage, setTerminalSize } from "bit-lite-terminal";
import { WORKER_RUNNER_START_RESULT_MESSAGE_TYPE } from "./worker-protocol.js";
import type {
  RunnerStartResult,
  RunnerParentMessageListener,
  RunnerRuntime,
  RunnerTargetModule,
  WorkerRunnerData,
} from "./index.js";

const data = workerData as WorkerRunnerData;
const parentMessageListeners = new Set<RunnerParentMessageListener>();
let runnerStartResult: RunnerStartResult | void;

if (data.emulateTty) {
  installWorkerTtyShim({ terminal: data.terminal });
}

const runtime: RunnerRuntime = {
  data: data.data,
  postMessage(message) {
    parentPort?.postMessage(message);
  },
  onMessage(listener) {
    parentMessageListeners.add(listener);
    return () => parentMessageListeners.delete(listener);
  },
};

parentPort?.on("message", async (message) => {
  if (isTerminalResizeMessage(message)) {
    setTerminalSize(message);
    return;
  }

  for (const listener of parentMessageListeners) await listener(message);

  if (isShutdownMessage(message)) {
    await runnerStartResult?.stop?.();
    process.exit(0);
  }
});

try {
  const runnerModule = (await import(data.moduleUrl)) as RunnerTargetModule;
  const startRunnerTarget = runnerModule.default;

  if (typeof startRunnerTarget !== "function") {
    throw new Error("Runner target module must default export a StartRunnerTarget function.");
  }

  runnerStartResult = await startRunnerTarget(runtime);
  parentPort?.postMessage({
    type: WORKER_RUNNER_START_RESULT_MESSAGE_TYPE,
    data: runnerStartResult?.data,
  });
} catch (error) {
  runtime.postMessage({ type: "error", message: formatError(error) });
  console.error(error);
  process.exit(1);
}

function isShutdownMessage(message: unknown) {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "shutdown";
}

function formatError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

import { parentPort, workerData } from "node:worker_threads";
import { installWorkerTtyShim, isTerminalResizeMessage, setTerminalSize } from "bit-lite-terminal";
import {
  isWorkerRunnerShutdownMessage,
  WORKER_RUNNER_START_RESULT_MESSAGE_TYPE,
} from "./worker-protocol.js";
import type {
  RunnerStartResult,
  RunnerParentMessageListener,
  RunnerRuntime,
  RunnerTargetModule,
  WorkerRunnerData,
} from "./index.js";

const data = workerData as WorkerRunnerData;
const parentMessageListeners = new Set<RunnerParentMessageListener<unknown>>();
let runnerStartResult: RunnerStartResult | void;
let runnerStarted = false;
let shutdownRequested = false;
let shutdownPromise: Promise<void> | undefined;

if (data.emulateTty) {
  installWorkerTtyShim({ terminal: data.terminal });
}

const runtime: RunnerRuntime<unknown, unknown, unknown> = {
  data: data.data,
  postMessage(message) {
    parentPort?.postMessage(message);
  },
  onMessage(listener) {
    parentMessageListeners.add(listener);
    return () => parentMessageListeners.delete(listener);
  },
};

parentPort?.on("message", (message) => {
  if (isTerminalResizeMessage(message)) {
    setTerminalSize(message);
    return;
  }

  if (isWorkerRunnerShutdownMessage(message)) {
    shutdownRequested = true;
    if (runnerStarted) void shutdown();
    return;
  }

  void dispatchApplicationMessage(message);
});

try {
  const runnerModule = (await import(data.moduleUrl)) as RunnerTargetModule<
    unknown,
    unknown,
    unknown
  >;
  const startRunnerTarget = runnerModule.default;

  if (typeof startRunnerTarget !== "function") {
    throw new Error("Runner target module must default export a StartRunnerTarget function.");
  }

  runnerStartResult = await startRunnerTarget(runtime);
  runnerStarted = true;
  if (shutdownRequested) {
    await shutdown();
  }
  parentPort?.postMessage({
    type: WORKER_RUNNER_START_RESULT_MESSAGE_TYPE,
    data: runnerStartResult?.data,
  });
} catch (error) {
  runtime.postMessage({ type: "error", message: formatError(error) });
  console.error(error);
  process.exit(1);
}

async function dispatchApplicationMessage(message: unknown) {
  for (const listener of parentMessageListeners) await listener(message);
}

function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    try {
      await runnerStartResult?.stop?.();
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  })();
  return shutdownPromise;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

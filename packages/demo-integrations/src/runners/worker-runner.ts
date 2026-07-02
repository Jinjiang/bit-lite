import { Worker } from "node:worker_threads";
import type {
  ManagerMessage,
  OutputListener,
  RunnerExitCode,
  ServiceData,
  ServiceDefinition,
  ServiceMessageListener,
  ServiceRunner,
  WorkerServiceData,
} from "../types.js";

// Worker runner: starts a service in a Worker Thread and exposes a small runner
// API to the parent process. This is the only file that directly touches
// Node's Worker constructor.
export function createWorkerRunner(service: ServiceDefinition, serviceData: ServiceData): ServiceRunner {
  const outputListeners = new Set<OutputListener>();
  const messageListeners = new Set<ServiceMessageListener>();
  let worker: Worker | undefined;
  let resolveExit!: (code: RunnerExitCode) => void;

  const exitPromise = new Promise<RunnerExitCode>((resolve) => {
    resolveExit = resolve;
  });

  return {
    kind: "worker",
    exitPromise,
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onOutput(listener) {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
    send(message: ManagerMessage) {
      worker?.postMessage(message);
    },
    start() {
      const workerData: WorkerServiceData = {
        ...serviceData,
        serviceModuleUrl: service.serviceModuleUrl.href,
        tsxApiUrl: import.meta.resolve("tsx/esm/api"),
      };

      worker = new Worker(createWorkerEntryUrl(), {
        workerData,
        // These flags keep worker terminal output separate from the parent
        // process. The parent can then decide how to display each stream.
        stdout: true,
        stderr: true,
        // Kept for future experiments where selected terminal input is
        // forwarded to a specific worker.
        stdin: true,
      });

      worker.stdout?.on("data", (chunk: Buffer) => emitOutput("stdout", chunk));
      worker.stderr?.on("data", (chunk: Buffer) => emitOutput("stderr", chunk));
      worker.on("message", (message) => {
        for (const listener of messageListeners) listener(message);
      });
      worker.on("error", (error: Error) => {
        for (const listener of messageListeners) {
          listener({ type: "error", message: error.stack ?? error.message });
        }
      });
      worker.once("exit", (code) => {
        resolveExit(code);
      });
    },
    async stop() {
      this.send({ type: "shutdown" });
    },
    async terminate() {
      if (worker) await worker.terminate();
    },
  };

  function emitOutput(stream: "stdout" | "stderr", chunk: Buffer) {
    for (const listener of outputListeners) listener(stream, chunk);
  }
}

// Generate one generic Worker entry instead of keeping one wrapper file per
// service. The entry imports the service module named in workerData and runs the
// same runtime contract used by inline mode.
function createWorkerEntryUrl() {
  return new URL(`data:text/javascript,${encodeURIComponent(workerEntrySource)}`);
}

const workerEntrySource = String.raw`
import { parentPort, workerData } from "node:worker_threads";

const serviceMessageListeners = new Set();
let serviceHandle;

const runtime = {
  data: workerData,
  postMessage(message) {
    parentPort?.postMessage(message);
  },
  onMessage(listener) {
    serviceMessageListeners.add(listener);
    return () => serviceMessageListeners.delete(listener);
  },
};

parentPort?.on("message", async (message) => {
  for (const listener of serviceMessageListeners) await listener(message);

  if (message?.type === "shutdown") {
    await serviceHandle?.stop?.();
    process.exit(0);
  }
});

try {
  const { tsImport } = await import(workerData.tsxApiUrl);
  const serviceModule = await tsImport(workerData.serviceModuleUrl, {
    parentURL: workerData.serviceModuleUrl,
  });
  const startService = serviceModule.default;

  if (typeof startService !== "function") {
    throw new Error("Service module must default export a StartService function.");
  }

  serviceHandle = await startService(runtime);
} catch (error) {
  runtime.postMessage({ type: "error", message: error.stack ?? error.message });
  console.error(error);
  process.exit(1);
}
`;

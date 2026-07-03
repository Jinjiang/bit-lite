import { Worker } from "node:worker_threads";
import { bindTerminalResize, readTerminalSize } from "bit-lite-terminal";
import type {
  ManagerMessage,
  OutputListener,
  RunnerExitCode,
  VendorConfig,
  VendorData,
  VendorDefinition,
  VendorMessageListener,
  VendorRunner,
  WorkerVendorData,
} from "../types.js";

// Worker runner: starts a vendor in a Worker Thread and exposes a small runner
// API to the parent process. This is the only file that directly touches
// Node's Worker constructor.
export function createWorkerRunner<Config extends VendorConfig>(
  vendor: VendorDefinition<Config>,
  vendorData: VendorData<Config>
): VendorRunner {
  const outputListeners = new Set<OutputListener>();
  const messageListeners = new Set<VendorMessageListener>();
  let worker: Worker | undefined;
  let unbindTerminalResize: (() => void) | undefined;
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
    writeInput(chunk) {
      worker?.stdin?.write(chunk);
    },
    start() {
      const workerData: WorkerVendorData<Config> = {
        vendorData,
        vendorModuleUrl: vendor.vendorModuleUrl.href,
        terminalApiUrl: import.meta.resolve("bit-lite-terminal"),
        terminal: readTerminalSize(),
        emulateTty: true,
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
      unbindTerminalResize = bindTerminalResize(worker);
      worker.on("message", (message) => {
        for (const listener of messageListeners) listener(message);
      });
      worker.on("error", (error: Error) => {
        for (const listener of messageListeners) {
          listener({ type: "error", message: error.stack ?? error.message });
        }
      });
      worker.once("exit", (code) => {
        unbindTerminalResize?.();
        unbindTerminalResize = undefined;
        resolveExit(code);
      });
    },
    async stop() {
      this.send({ type: "shutdown" });
    },
    async terminate() {
      unbindTerminalResize?.();
      unbindTerminalResize = undefined;
      if (worker) await worker.terminate();
    },
  };

  function emitOutput(stream: "stdout" | "stderr", chunk: Buffer) {
    for (const listener of outputListeners) listener(stream, chunk);
  }
}

// Generate one generic Worker entry instead of keeping one wrapper file per
// vendor. The entry imports the vendor module named in workerData and runs the
// same runtime contract used by inline mode.
function createWorkerEntryUrl() {
  return new URL(`data:text/javascript,${encodeURIComponent(workerEntrySource)}`);
}

const workerEntrySource = String.raw`
import { parentPort, workerData } from "node:worker_threads";

const vendorMessageListeners = new Set();
let vendorHandle;
let terminalApi;
const { tsImport } = await import(workerData.tsxApiUrl);

if (workerData.emulateTty) {
  terminalApi = await tsImport(workerData.terminalApiUrl, {
    parentURL: workerData.terminalApiUrl,
  });
  terminalApi.installWorkerTtyShim({ terminal: workerData.terminal });
}

const runtime = {
  data: workerData.vendorData,
  postMessage(message) {
    parentPort?.postMessage(message);
  },
  onMessage(listener) {
    vendorMessageListeners.add(listener);
    return () => vendorMessageListeners.delete(listener);
  },
};

parentPort?.on("message", async (message) => {
  if (terminalApi?.isTerminalResizeMessage(message)) {
    terminalApi.setTerminalSize(message);
    return;
  }

  for (const listener of vendorMessageListeners) await listener(message);

  if (message?.type === "shutdown") {
    await vendorHandle?.stop?.();
    process.exit(0);
  }
});

try {
  const vendorModule = await tsImport(workerData.vendorModuleUrl, {
    parentURL: workerData.vendorModuleUrl,
  });
  const startVendor = vendorModule.default;

  if (typeof startVendor !== "function") {
    throw new Error("Vendor module must default export a StartVendor function.");
  }

  vendorHandle = await startVendor(runtime);
} catch (error) {
  runtime.postMessage({ type: "error", message: error.stack ?? error.message });
  console.error(error);
  process.exit(1);
}
`;

import { Worker } from "node:worker_threads";
import { bindTerminalResize, readTerminalSize } from "bit-lite-terminal";

const emulateTty = process.env.DEMO_VITE_WORKER_TTY_SHIM === "1";

const workerEntrySource = String.raw`
import { parentPort, workerData } from "node:worker_threads";

let handle;
let terminalApi;
const { tsImport } = await import(workerData.tsxApiUrl);

if (workerData.emulateTty) {
  terminalApi = await tsImport(workerData.terminalApiUrl, {
    parentURL: workerData.terminalApiUrl,
  });
  terminalApi.installWorkerTtyShim({ terminal: workerData.terminal });
}

parentPort?.on("message", async (message) => {
  if (terminalApi?.isTerminalResizeMessage(message)) {
    terminalApi.setTerminalSize(message);
    return;
  }

  if (message?.type === "shutdown") {
    await handle?.close?.();
    process.exit(0);
  }
});

try {
  const serverModule = await tsImport(workerData.serverModuleUrl, {
    parentURL: workerData.serverModuleUrl,
  });

  handle = await serverModule.startViteDevServer();
} catch (error) {
  console.error(error);
  process.exit(1);
}
`;

const worker = new Worker(createWorkerEntryUrl(), {
  workerData: {
    emulateTty,
    serverModuleUrl: new URL("./start-vite-dev-server.ts", import.meta.url).href,
    terminal: readTerminalSize(),
    terminalApiUrl: import.meta.resolve("bit-lite-terminal"),
    tsxApiUrl: import.meta.resolve("tsx/esm/api"),
  },
  stdout: true,
  stderr: true,
  stdin: true,
});

let shuttingDown = false;
const unbindTerminalResize = emulateTty ? bindTerminalResize(worker) : undefined;

const exitPromise = new Promise<number>((resolve) => {
  worker.once("exit", (code) => {
    unbindTerminalResize?.();
    resolve(code);
  });
});

worker.stdout?.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk);
});

worker.stderr?.on("data", (chunk: Buffer) => {
  process.stderr.write(chunk);
});

worker.on("error", (error) => {
  console.error(error);
});

process.stdin.on("data", (chunk: Buffer) => {
  worker.stdin?.write(chunk);
});

process.on("SIGINT", () => {
  shutdown(0);
});

process.on("SIGTERM", () => {
  shutdown(0);
});

const exitCode = await exitPromise;
process.exit(exitCode);

async function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;

  worker.postMessage({ type: "shutdown" });
  await Promise.race([exitPromise, new Promise((resolve) => setTimeout(resolve, 3000))]);
  unbindTerminalResize?.();
  if (worker.threadId !== -1) await worker.terminate();
  process.exit(code);
}

function createWorkerEntryUrl() {
  return new URL(`data:text/javascript,${encodeURIComponent(workerEntrySource)}`);
}

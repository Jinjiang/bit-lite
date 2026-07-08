const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");
const { parentPort, workerData } = require("node:worker_threads");
const { createVitestResult, formatVitestTextResult } = require("../vitest-result-format.cjs");

const packageRoot = workerData.packageRoot;
let terminalModule;
let runCount = 0;

parentPort?.on("message", (message) => {
  if (terminalModule?.isTerminalResizeMessage(message)) {
    terminalModule.setTerminalSize(message);
  }
});

run().catch((error) => {
  parentPort?.postMessage({ type: "error", vendor: "vitest", message: formatError(error) });
  process.exit(1);
});

async function run() {
  await installTerminalShim();
  const { startVitest } = await import(pathToFileURL(resolveFromDemoVendors("vitest/node")).href);
  const reporter = {
    onTestRunStart() {
      parentPort?.postMessage({ type: "status", vendor: "vitest", status: "running" });
    },
    onTestRunEnd(testModules, unhandledErrors, reason) {
      runCount += 1;
      const json = createVitestResult(runCount, testModules, unhandledErrors, reason);
      parentPort?.postMessage({
        type: "result",
        vendor: "vitest",
        run: runCount,
        json,
        text: formatVitestTextResult(json),
      });
      parentPort?.postMessage({ type: "status", vendor: "vitest", status: "watching" });
    },
  };

  await startVitest(
    "test",
    [],
    {
      root: packageRoot,
      include: ["fixtures/vitest/**/*.test.mjs"],
      run: false,
      watch: true,
      reporters: ["default", reporter],
      passWithNoTests: true,
    }
  );

  parentPort?.postMessage({ type: "status", vendor: "vitest", status: "watching" });
}

async function installTerminalShim() {
  terminalModule = await import(pathToFileURL(path.join(packageRoot, "../bit-lite-terminal/dist/index.js")).href);
  terminalModule.installWorkerTtyShim({ terminal: workerData.terminal });
}

function resolveFromDemoVendors(specifier) {
  const demoVendorsRequire = createRequire(path.join(packageRoot, "../demo-vendors/package.json"));
  return demoVendorsRequire.resolve(specifier);
}

function formatError(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

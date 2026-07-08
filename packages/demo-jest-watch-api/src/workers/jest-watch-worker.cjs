const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");
const { parentPort, workerData } = require("node:worker_threads");

const packageRoot = workerData.packageRoot;
let terminalModule;

parentPort?.on("message", (message) => {
  if (terminalModule?.isTerminalResizeMessage(message)) {
    terminalModule.setTerminalSize(message);
    return;
  }

  if (message?.type !== "shutdown") return;
  parentPort?.postMessage({ type: "status", vendor: "jest", status: "stopped" });
  process.exit(0);
});

run().catch((error) => {
  parentPort?.postMessage({ type: "error", vendor: "jest", message: formatError(error) });
  process.exit(1);
});

async function run() {
  await installTerminalShim();
  const { runCLI } = require(resolveFromDemoVendors("jest"));
  const config = {
    rootDir: packageRoot,
    testMatch: ["<rootDir>/fixtures/**/*.test.cjs"],
    watchPathIgnorePatterns: [path.join("/private/tmp", "demo-jest-watch-api"), "<rootDir>/results/"],
  };

  parentPort?.postMessage({ type: "status", vendor: "jest", status: "watching" });

  await runCLI(
    {
      _: [],
      $0: "demo-jest-watch-api jest-worker",
      colors: false,
      config: JSON.stringify(config),
      passWithNoTests: true,
      runInBand: true,
      silent: true,
      watch: false,
      watchAll: true,
      watchPlugins: [[path.join(packageRoot, "src/workers/jest-event-watch-plugin.cjs"), {}]],
    },
    [packageRoot]
  );
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

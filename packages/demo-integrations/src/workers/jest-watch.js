import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";

// Jest project root containing the tiny fixture test suite.
const fixtureRoot = path.join(workerData.packageRoot, "fixtures/jest");

// Jest watch mode does not expose a close handle from runCLI(), so this demo
// stops the worker process itself when the parent asks it to shut down.
parentPort?.on("message", (message) => {
  if (message?.type !== "shutdown") return;

  console.log("Stopping Jest watch worker...");
  process.exit(0);
});

// Start Jest immediately and report startup errors through both channels.
start().catch((error) => {
  parentPort?.postMessage({ type: "error", message: error.stack ?? error.message });
  console.error(error);
  process.exit(1);
});

// Run Jest in watchAll mode through the public Node API.
async function start() {
  // Dynamic import keeps the worker startup explicit and makes this file work as
  // an ES module even though Jest still exposes some CommonJS-shaped exports.
  const jestModule = await import("jest");
  const runCLI = jestModule.runCLI ?? jestModule.default?.runCLI;

  if (typeof runCLI !== "function") {
    throw new Error("Unable to locate jest.runCLI");
  }

  console.log("Starting Jest watch mode through runCLI()...");
  // `watching` is an intermediate status. `ready` tells the parent that the
  // watch process has been handed off to Jest.
  parentPort?.postMessage({ type: "status", status: "watching" });
  parentPort?.postMessage({ type: "ready" });

  // Inline config keeps this package independent of the rest of the workspace.
  const config = {
    rootDir: fixtureRoot,
    testEnvironment: "node",
    testMatch: ["**/*.test.cjs"],
    verbose: true,
  };

  await runCLI(
    {
      $0: "demo-integrations",
      _: [],
      config: JSON.stringify(config),
      colors: false,
      runInBand: true,
      watchAll: true,
    },
    [fixtureRoot]
  );

  // In watch mode runCLI normally never resolves. This line is here only for
  // completeness if Jest ever exits by itself.
  console.log("Jest watch mode finished.");
}

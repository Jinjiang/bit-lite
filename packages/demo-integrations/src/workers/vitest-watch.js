import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";
import { startVitest } from "vitest/node";

// Vitest project root containing the tiny fixture test suite.
const fixtureRoot = path.join(workerData.packageRoot, "fixtures/vitest");

// Running Vitest instance returned by startVitest().
let vitest;

// Close the Vitest instance when the parent manager begins shutdown.
parentPort?.on("message", async (message) => {
  if (message?.type !== "shutdown") return;

  await stopVitest();
  process.exit(0);
});

// Start Vitest immediately and make startup failures visible to the parent.
start().catch((error) => {
  parentPort?.postMessage({ type: "error", message: error.stack ?? error.message });
  console.error(error);
  process.exit(1);
});

// Run Vitest watch mode through the Vitest Node API.
async function start() {
  console.log("Starting Vitest watch mode through startVitest()...");
  parentPort?.postMessage({ type: "status", status: "watching" });

  // The first object is Vitest CLI-like options. The second object is inline
  // Vite/Vitest config, avoiding a separate config file for this demo.
  vitest = await startVitest(
    "test",
    [],
    {
      root: fixtureRoot,
      config: false,
      watch: true,
      reporters: "default",
      passWithNoTests: false,
    },
    {
      root: fixtureRoot,
      configFile: false,
      test: {
        include: ["**/*.test.js"],
        environment: "node",
        watch: true,
        pool: "threads",
      },
    }
  );

  // startVitest can return undefined if startup did not produce a running
  // instance, so fail loudly instead of leaving the parent stuck at `watching`.
  if (!vitest) {
    throw new Error("Vitest did not return a running instance");
  }

  parentPort?.postMessage({ type: "ready" });
}

// Close the running Vitest watch process if present.
async function stopVitest() {
  if (!vitest) return;

  console.log("Stopping Vitest watch mode...");
  await vitest.close();
  vitest = undefined;
}

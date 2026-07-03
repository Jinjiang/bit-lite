import path from "node:path";
import type { VendorHandle, VendorRuntime } from "../types.js";

// Run Jest in watchAll mode through the public Node API. Jest runCLI does not
// expose a close handle for watch mode, so stop() is intentionally best-effort.
export default async function startJestWatch(runtime: VendorRuntime): Promise<VendorHandle> {
  const fixtureRoot = path.join(runtime.data.packageRoot, "fixtures/jest");

  // Dynamic import keeps this file ESM-friendly even though Jest exposes some
  // CommonJS-shaped exports.
  const jestModule = await import("jest");
  const runCLI = (jestModule as { runCLI?: unknown; default?: { runCLI?: unknown } }).runCLI ?? jestModule.default?.runCLI;

  if (typeof runCLI !== "function") {
    throw new Error("Unable to locate jest.runCLI");
  }

  console.log("Starting Jest watch mode through runCLI()...");
  runtime.postMessage({ type: "status", status: "watching" });
  runtime.postMessage({ type: "ready" });

  // Inline config keeps this package independent of the rest of the workspace.
  const config = {
    rootDir: fixtureRoot,
    testEnvironment: "node",
    testMatch: ["**/*.test.cjs"],
    verbose: true,
  };

  // Do not await this promise. In watch mode, runCLI normally never resolves.
  // Let it own its file watchers while the runner keeps the vendor handle.
  runCLI(
    {
      $0: "demo-integrations",
      _: [],
      config: JSON.stringify(config),
      colors: false,
      runInBand: true,
      watchAll: true,
    },
    [fixtureRoot]
  ).catch((error: unknown) => {
    runtime.postMessage({ type: "error", message: formatError(error) });
    console.error(error);
  });

  return {
    async stop() {
      console.log("Stopping Jest watch mode...");
    },
  };
}

function formatError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

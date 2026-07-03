import path from "node:path";
import { startVitest } from "vitest/node";
import type { VendorHandle, VendorRuntime } from "../types.js";

// Run Vitest watch mode through the Vitest Node API. This function is shared by
// both runner modes.
export default async function startVitestWatch(runtime: VendorRuntime): Promise<VendorHandle> {
  const fixtureRoot = path.join(runtime.data.packageRoot, "fixtures/vitest");
  let vitest: Awaited<ReturnType<typeof startVitest>> | undefined;

  console.log("Starting Vitest watch mode through startVitest()...");
  runtime.postMessage({ type: "status", status: "watching" });

  // The first object is Vitest CLI-like options. The second object is inline
  // Vite/Vitest config, avoiding a separate config file for this demo.
  vitest = await startVitest(
    "test",
    [],
    {
      root: fixtureRoot,
      config: false,
      watch: true,
      include: ["**/*.test.js"],
      environment: "node",
      pool: "threads",
      reporters: "default",
      passWithNoTests: false,
    }
  );

  // startVitest can return undefined if startup did not produce a running
  // instance, so fail loudly instead of leaving the parent stuck at `watching`.
  if (!vitest) {
    throw new Error("Vitest did not return a running instance");
  }

  runtime.postMessage({ type: "ready" });

  return {
    async stop() {
      if (!vitest) return;

      console.log("Stopping Vitest watch mode...");
      await vitest.close();
      vitest = undefined;
    },
  };
}

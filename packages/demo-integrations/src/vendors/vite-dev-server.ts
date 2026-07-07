import path from "node:path";
import { createServer } from "vite";
import { findOpenPort } from "../utils/ports.js";
import type { DevServerVendorConfig, VendorStartResult, VendorRuntime } from "../types.js";

// Create and start Vite Dev Server using Vite's JavaScript API. This function
// is shared by the inline runner and the Worker Thread runner.
export default async function startViteDevServer(runtime: VendorRuntime<DevServerVendorConfig>): Promise<VendorStartResult> {
  const fixtureRoot = path.join(runtime.data.packageRoot, "fixtures/vite");
  let server: Awaited<ReturnType<typeof createServer>> | undefined;

  // Pick a predictable port unless it is already occupied.
  const port = await findOpenPort(runtime.data.config.preferredPort);

  console.log("Starting Vite Dev Server through createServer()...");
  server = await createServer({
    root: fixtureRoot,
    configFile: false,
    logLevel: "info",
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      // hmr: false,
    },
    plugins: [
      {
        name: "demo-integrations-vite-console-plugin",
        // Deliberate plugin-level stdout to test the selected output mode.
        configureServer() {
          console.log("[vite plugin] configureServer wrote to stdout");
        },
        // Another hook that runs during startup and writes to stdout.
        buildStart() {
          console.log("[vite plugin] buildStart wrote to stdout");
        },
        handleHotUpdate(context) {
          console.log(`[vite plugin] hot update: ${path.relative(fixtureRoot, context.file)}`);
        },
      },
    ],
  });

  await server.listen();
  // Let Vite print its normal URL output. Inline mode prints this directly;
  // worker mode lets the parent capture it from the worker stdout stream.
  server.printUrls();

  const url = `http://127.0.0.1:${port}`;
  runtime.postMessage({ type: "result", data: { kind: "dev-server", url, port } });
  runtime.postMessage({ type: "ready" });

  return {
    async stop() {
      if (!server) return;

      console.log("Stopping Vite Dev Server...");
      await server.close();
      server = undefined;
    },
  };
}

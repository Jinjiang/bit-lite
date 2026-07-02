import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";
import { createServer } from "vite";
import { findOpenPort } from "../utils/ports.js";

// Fixture directory used as the Vite project root.
const fixtureRoot = path.join(workerData.packageRoot, "fixtures/vite");

// The Vite dev server instance returned by createServer().
let server;

// Listen for parent shutdown messages and close the Vite server cooperatively.
parentPort?.on("message", async (message) => {
  if (message?.type !== "shutdown") return;

  await stopServer();
  process.exit(0);
});

// Start the Vite server as soon as the worker loads. Any startup failure is sent
// through both the structured worker channel and stderr.
start().catch((error) => {
  parentPort?.postMessage({ type: "error", message: error.stack ?? error.message });
  console.error(error);
  process.exit(1);
});

// Create and start Vite Dev Server using Vite's JavaScript API.
async function start() {
  // Pick a predictable port unless it is already occupied.
  const port = await findOpenPort(workerData.preferredPort);

  console.log("Starting Vite Dev Server through createServer()...");
  server = await createServer({
    root: fixtureRoot,
    configFile: false,
    logLevel: "info",
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      hmr: false,
    },
    plugins: [
      {
        name: "demo-integrations-vite-console-plugin",
        // Deliberate plugin-level stdout to test that Vite plugin logs stay in
        // this worker's captured stream.
        configureServer() {
          console.log("[vite plugin] configureServer wrote to stdout");
        },
        // Another hook that runs during startup and writes to stdout.
        buildStart() {
          console.log("[vite plugin] buildStart wrote to stdout");
        },
      },
    ],
  });

  await server.listen();
  // Let Vite print its normal URL output. The parent will capture this from the
  // worker stdout stream.
  server.printUrls();

  // Structured readiness message used by the parent menu state.
  const url = `http://127.0.0.1:${port}`;
  parentPort?.postMessage({ type: "ready", url });
}

// Close the Vite server if it has been started.
async function stopServer() {
  if (!server) return;

  console.log("Stopping Vite Dev Server...");
  await server.close();
  server = undefined;
}

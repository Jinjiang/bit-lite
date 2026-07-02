import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";
import os from "node:os";
import webpack from "webpack";
import WebpackDevServer from "webpack-dev-server";
import { findOpenPort } from "../utils/ports.js";

// Fixture directory served by this worker's Webpack Dev Server.
const fixtureRoot = path.join(workerData.packageRoot, "fixtures/webpack");

// The running WebpackDevServer instance. It is kept at module scope so the
// shutdown handler can close it later.
let server;

// The parent process asks workers to stop by sending a structured message. This
// keeps service shutdown separate from raw stdout/stderr output.
parentPort?.on("message", async (message) => {
  if (message?.type !== "shutdown") return;

  await stopServer();
  process.exit(0);
});

// Start immediately when the worker module is loaded. Errors are mirrored both
// as a structured parent message and as stderr so the output manager can display
// them in the selected service log.
start().catch((error) => {
  parentPort?.postMessage({ type: "error", message: error.stack ?? error.message });
  console.error(error);
  process.exit(1);
});

// Create and start Webpack Dev Server entirely through the Node API.
async function start() {
  // Prefer a stable demo port, but avoid failing if the port is already in use.
  const port = await findOpenPort(workerData.preferredPort);

  // Webpack compiler configuration kept inline so the demo is self-contained.
  const compiler = webpack({
    mode: "development",
    context: fixtureRoot,
    entry: path.join(fixtureRoot, "src/index.js"),
    output: {
      path: path.join(os.tmpdir(), "demo-integrations-webpack"),
      filename: "bundle.js",
      publicPath: "/",
    },
    infrastructureLogging: {
      // Leave some Webpack Dev Server output visible so stdout/stderr capture is
      // obvious in the terminal manager.
      level: "info",
    },
    stats: "minimal",
    // This plugin deliberately writes with console.log from inside Webpack to
    // demonstrate that plugin output stays owned by this worker.
    plugins: [new ConsoleOutputPlugin()],
  });

  // WebpackDevServer v5 exposes `start()` / `stop()` as its Node API.
  server = new WebpackDevServer(
    {
      host: "127.0.0.1",
      port,
      hot: false,
      liveReload: false,
      client: false,
      static: {
        directory: fixtureRoot,
      },
      devMiddleware: {
        publicPath: "/",
      },
    },
    compiler
  );

  console.log("Starting Webpack Dev Server through its Node API...");
  await server.start();

  // Report readiness via a structured message. The human-readable console line
  // is still captured through worker stdout.
  const url = `http://127.0.0.1:${port}`;
  console.log(`Webpack Dev Server is listening on ${url}`);
  parentPort?.postMessage({ type: "ready", url });
}

// Close the dev server if it exists. The guard makes repeated shutdown messages
// harmless.
async function stopServer() {
  if (!server) return;

  console.log("Stopping Webpack Dev Server...");
  await server.stop();
  server = undefined;
}

// Minimal Webpack plugin used to prove that third-party/plugin console output is
// captured by the worker stdout stream rather than the global parent terminal.
class ConsoleOutputPlugin {
  apply(compiler) {
    // Runs before a compilation is created.
    compiler.hooks.beforeCompile.tap("DemoIntegrationsConsoleOutputPlugin", () => {
      console.log("[webpack plugin] beforeCompile wrote to stdout");
    });

    // Runs after a compilation completes and prints a tiny summary.
    compiler.hooks.done.tap("DemoIntegrationsConsoleOutputPlugin", (stats) => {
      const info = stats.toJson({ all: false, errors: true, warnings: true });
      console.log(`[webpack plugin] done with ${info.errors?.length ?? 0} errors and ${info.warnings?.length ?? 0} warnings`);
    });
  }
}

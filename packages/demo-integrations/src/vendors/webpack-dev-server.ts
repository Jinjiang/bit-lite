import path from "node:path";
import os from "node:os";
import webpack from "webpack";
import WebpackDevServer from "webpack-dev-server";
import { findOpenPort } from "../utils/ports.js";
import type { Compiler, Stats } from "webpack";
import type { DevServerVendorConfig, VendorStartResult, VendorRuntime } from "../types.js";

// Create and start Webpack Dev Server entirely through the Node API. The
// `runtime` argument is the abstraction shared by inline and worker execution.
export default async function startWebpackDevServer(runtime: VendorRuntime<DevServerVendorConfig>): Promise<VendorStartResult> {
  const fixtureRoot = path.join(runtime.data.packageRoot, "fixtures/webpack");
  let server: WebpackDevServer | undefined;

  // Prefer a stable demo port, but avoid failing if the port is already in use.
  const port = await findOpenPort(runtime.data.config.preferredPort);

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
      // obvious when running through the worker runner.
      level: "info",
    },
    stats: "minimal",
    // This plugin deliberately writes with console.log from inside Webpack to
    // demonstrate that plugin output follows the selected runner behavior.
    plugins: [new ConsoleOutputPlugin()],
  }) as Compiler;

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

  const url = `http://127.0.0.1:${port}`;
  console.log(`Webpack Dev Server is listening on ${url}`);
  runtime.postMessage({ type: "result", data: { kind: "dev-server", url, port } });
  runtime.postMessage({ type: "ready" });

  return {
    async stop() {
      if (!server) return;

      console.log("Stopping Webpack Dev Server...");
      await server.stop();
      server = undefined;
    },
  };
}

// Minimal Webpack plugin used to prove that third-party/plugin console output is
// affected by the selected runner: direct in inline mode, proxied in worker mode.
class ConsoleOutputPlugin {
  apply(compiler: Compiler) {
    // Runs before a compilation is created.
    compiler.hooks.beforeCompile.tap("DemoIntegrationsConsoleOutputPlugin", () => {
      console.log("[webpack plugin] beforeCompile wrote to stdout");
    });

    // Runs after a compilation completes and prints a tiny summary.
    compiler.hooks.done.tap("DemoIntegrationsConsoleOutputPlugin", (stats: Stats) => {
      const info = stats.toJson({ all: false, errors: true, warnings: true });
      console.log(`[webpack plugin] done with ${info.errors?.length ?? 0} errors and ${info.warnings?.length ?? 0} warnings`);
    });
  }
}

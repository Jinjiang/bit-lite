import { readFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import webpack from "webpack";
import webpackDevMiddleware from "webpack-dev-middleware";
import webpackHotMiddleware from "webpack-hot-middleware";
import type { Server } from "node:http";
import type { JsonObject, VendorDefinition, VendorRuntime, VendorStartResult } from "bit-lite-vendors";
import type { Configuration, Stats } from "webpack";
import {
  createPreviewServiceResult,
  readPreviewConfigFile,
  readPreviewRuntime,
  withPreviewVendorContext,
  type PreviewServiceResult,
  type PreviewVendorRuntime,
} from "../core.js";

const require = createRequire(import.meta.url);
const webpackHotClient = require.resolve("webpack-hot-middleware/client");

export const meta: VendorDefinition = {
  id: "webpack-preview",
  label: "Webpack Preview",
  hint: "Serve a command-prepared preview entry with Webpack",
  moduleUrl: import.meta.url,
};

type WebpackPreviewMiddleware = ReturnType<typeof webpackDevMiddleware> & {
  waitUntilValid(callback: (stats?: Stats) => void): void;
  close(callback: (error?: Error) => void): void;
};

type WebpackPreviewMiddlewareHandler = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  next: () => void
) => void;

type WebpackHotMiddleware = ReturnType<typeof webpackHotMiddleware> & { close(): void };

export default async function startWebpackPreviewVendor(
  runtime: VendorRuntime<JsonObject, PreviewServiceResult, never, PreviewVendorRuntime>
): Promise<VendorStartResult<PreviewServiceResult>> {
  const previewRuntime = readPreviewRuntime(runtime.data.runtime);
  const workspaceRoot = runtime.data.context.workspace.rootDir;
  const configFile = readPreviewConfigFile(runtime.data.config);
  let server: Server | undefined;
  let middleware: WebpackPreviewMiddleware | undefined;
  let hotMiddleware: WebpackHotMiddleware | undefined;
  let stopped = false;
  let stopping: Promise<void> | undefined;

  runtime.postMessage({ type: "ready" });
  runtime.postMessage({ type: "status", status: "building" });

  try {
    const [html, userConfig] = await Promise.all([
      readFile(previewRuntime.prepared.htmlFile, "utf8"),
      importWebpackConfig(configFile),
    ]);
    const compiler = webpack(createWebpackConfig(userConfig, workspaceRoot, previewRuntime));
    if (!compiler) throw new Error("Webpack did not create a compiler");

    middleware = webpackDevMiddleware(compiler, {
      publicPath: webpackPublicPath(previewRuntime),
      stats: "errors-warnings",
    }) as WebpackPreviewMiddleware;
    hotMiddleware = webpackHotMiddleware(compiler, {
      path: webpackHotPath(previewRuntime),
      log: false,
    }) as WebpackHotMiddleware;
    server = http.createServer((request, response) => {
      if (request.method !== "GET" || request.url === undefined) {
        response.statusCode = 405;
        response.end("Method not allowed");
        return;
      }

      const pathname = new URL(request.url, "http://bit-lite-preview.local").pathname;
      if (pathname === previewRuntime.server.basePath || pathname === `${previewRuntime.server.basePath}index.html`) {
        sendHtml(response, 200, html);
        return;
      }

      (hotMiddleware as WebpackPreviewMiddlewareHandler | undefined)?.(request, response, () => {
        (middleware as WebpackPreviewMiddlewareHandler | undefined)?.(request, response, () => {
          response.statusCode = 404;
          response.end("Not found");
        });
      });
    });

    const actualPort = await listenOnPreviewPort(
      server,
      previewRuntime.server.host,
      previewRuntime.server.preferredPort,
      previewRuntime.server.fallbackStartPort
    );
    await waitUntilValid(middleware);

    const data = createPreviewServiceResult(actualPort);
    runtime.postMessage({ type: "result", data });
    runtime.postMessage({ type: "status", status: "ready" });
    return { stop };
  } catch (error) {
    runtime.postMessage({ type: "status", status: "error" });
    await stop().catch(() => undefined);
    throw withPreviewVendorContext(error, runtime.data.context.env, meta.id);
  }

  async function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      if (stopped) return;
      stopped = true;
      const activeServer = server;
      const activeMiddleware = middleware;
      const activeHotMiddleware = hotMiddleware;
      server = undefined;
      middleware = undefined;
      hotMiddleware = undefined;
      activeHotMiddleware?.close();
      await closeMiddleware(activeMiddleware);
      await closeServer(activeServer);
      runtime.postMessage({ type: "status", status: "stopped" });
    })();
    return stopping;
  }
}

function createWebpackConfig(
  userConfig: Configuration,
  workspaceRoot: string,
  runtime: PreviewVendorRuntime
): Configuration {
  return {
    ...userConfig,
    mode: userConfig.mode ?? "development",
    context: userConfig.context ?? workspaceRoot,
    devtool: userConfig.devtool ?? "eval-cheap-module-source-map",
    entry: {
      preview: [
        `${webpackHotClient}?path=${encodeURIComponent(webpackHotPath(runtime))}&reload=true`,
        runtime.prepared.entryFile,
      ],
    },
    output: {
      ...(userConfig.output ?? {}),
      path: path.join(workspaceRoot, ".bit-lite", "webpack-preview", sanitizeFileName(runtime.server.basePath)),
      publicPath: webpackPublicPath(runtime),
      filename: "[name].js",
      chunkFilename: "[name].[contenthash].js",
    },
    optimization: {
      ...(userConfig.optimization ?? {}),
      runtimeChunk: false,
    },
    resolve: {
      ...(userConfig.resolve ?? {}),
      alias: createWebpackWorkspaceAliases(userConfig.resolve?.alias, runtime),
    },
    plugins: [...(userConfig.plugins ?? []), new webpack.HotModuleReplacementPlugin()],
  };
}

export function createWebpackWorkspaceAliases(
  userAliases: WebpackAliases | undefined,
  runtime: PreviewVendorRuntime
): WebpackAliases {
  const workspacePackageNames = new Set(runtime.aliases.map(({ packageName }) => packageName));
  if (Array.isArray(userAliases)) {
    return [
      ...runtime.aliases.map(({ packageName, sourceDir }) => ({
        name: packageName,
        alias: sourceDir,
        onlyModule: true,
      })),
      ...userAliases.filter(({ name }) => !workspacePackageNames.has(stripExactAliasSuffix(name))),
    ];
  }
  const generatedAliases = Object.fromEntries(
    runtime.aliases.map(({ packageName, sourceDir }) => [`${packageName}$`, sourceDir])
  );
  const preservedAliases = Object.fromEntries(
    Object.entries(userAliases ?? {}).filter(([alias]) => !workspacePackageNames.has(stripExactAliasSuffix(alias)))
  );
  return { ...generatedAliases, ...preservedAliases };
}

type WebpackAliases = NonNullable<NonNullable<Configuration["resolve"]>["alias"]>;

function stripExactAliasSuffix(alias: string) {
  return alias.endsWith("$") ? alias.slice(0, -1) : alias;
}

async function importWebpackConfig(configFile: string): Promise<Configuration> {
  const moduleUrl = path.isAbsolute(configFile) ? pathToFileURL(configFile).href : configFile;
  const configModule = (await import(moduleUrl)) as { default?: unknown };
  const config = typeof configModule.default === "function" ? await configModule.default() : configModule.default;
  if (!isRecord(config)) throw new Error(`Webpack config "${configFile}" must default export an object`);
  return config as Configuration;
}

function webpackPublicPath(runtime: PreviewVendorRuntime) {
  return `${runtime.server.basePath}__bit-lite/`;
}

function webpackHotPath(runtime: PreviewVendorRuntime) {
  return `${runtime.server.basePath}__bit-lite/__webpack_hmr`;
}

function waitUntilValid(middleware: WebpackPreviewMiddleware) {
  return new Promise<void>((resolve, reject) => {
    middleware.waitUntilValid((stats) => {
      if (stats?.hasErrors()) {
        reject(new Error(stats.toString("errors-only")));
        return;
      }
      resolve();
    });
  });
}

function listen(server: Server, host: string, port: number) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      server.off("error", handleError);
      server.off("listening", handleListening);
    };
    const handleListening = () => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, host);
  });
}

async function listenOnPreviewPort(
  server: Server,
  host: string,
  preferredPort: number,
  fallbackStartPort: number
) {
  try {
    await listen(server, host, preferredPort);
    return readServerPort(server);
  } catch (error) {
    if (!isPortUnavailableError(error)) throw error;
  }

  for (let port = fallbackStartPort; port <= 65535; port += 1) {
    try {
      await listen(server, host, port);
      return readServerPort(server);
    } catch (error) {
      if (!isPortUnavailableError(error)) throw error;
    }
  }
  throw new Error(`No available preview port found at or after ${fallbackStartPort}`);
}

function readServerPort(server: Server) {
  const address = server.address();
  if (!address || typeof address === "string" || !Number.isInteger(address.port) || address.port <= 0) {
    throw new Error("Webpack preview server did not expose its actual bound port");
  }
  return address.port;
}

function isPortUnavailableError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}

function closeMiddleware(middleware: WebpackPreviewMiddleware | undefined) {
  if (!middleware) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    middleware.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function closeServer(server: Server | undefined) {
  if (!server) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (isServerNotRunningError(error)) resolve();
      else if (error) reject(error);
      else resolve();
    });
  });
}

function sendHtml(response: http.ServerResponse, statusCode: number, html: string) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(html);
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "env";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isServerNotRunningError(error: Error | undefined) {
  return error !== undefined && "code" in error && error.code === "ERR_SERVER_NOT_RUNNING";
}

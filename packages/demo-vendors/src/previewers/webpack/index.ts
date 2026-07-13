import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import webpack from "webpack";
import webpackDevMiddleware from "webpack-dev-middleware";
import type { Server } from "node:http";
import type { VendorDefinition, VendorRuntime, VendorStartResult } from "bit-lite-vendors";
import type { Configuration, EntryObject, Stats } from "webpack";
import {
  createPreviewServiceResult,
  discoverPreviewEntries,
  isShutdownMessage,
  matchPreviewRoute,
  readPreviewRuntime,
  readPreviewVendorConfig,
  renderCompositionHostPage,
  renderCompositionsPage,
  renderDocsPage,
  renderMessagePage,
  toWebpackImportSpecifier,
  type PreviewComponentEntry,
  type PreviewCompositionEntry,
  type PreviewServiceResult,
  type PreviewVendorConfig,
  type PreviewVendorRuntime,
} from "../core.js";

export const meta: VendorDefinition = {
  id: "webpack-preview",
  label: "Webpack Preview",
  hint: "Serve component docs and compositions with Webpack",
  moduleUrl: import.meta.url,
};

type WebpackPreviewBundle = {
  componentId: string;
  compositionId: string;
  entryName: string;
  scriptRoute: string;
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

export default async function startWebpackPreviewVendor(
  runtime: VendorRuntime<Record<string, unknown>, PreviewServiceResult, never, PreviewVendorRuntime>
): Promise<VendorStartResult<PreviewServiceResult>> {
  const workspaceRoot = runtime.data.context?.workspaceRoot ?? process.cwd();
  const previewRuntime = readPreviewRuntime(runtime.data.runtime);
  const vendorConfig = readPreviewVendorConfig(runtime.data.config, workspaceRoot);
  let tempDir: string | undefined;
  let server: Server | undefined;
  let middleware: WebpackPreviewMiddleware | undefined;
  let stopped = false;
  let stopping: Promise<void> | undefined;

  const unsubscribe = runtime.onMessage(async (message) => {
    if (isShutdownMessage(message)) await stop();
  });

  runtime.postMessage({ type: "ready" });
  runtime.postMessage({ type: "status", status: "building" });

  try {
    if (!vendorConfig.mounter) {
      throw new Error('webpack preview vendor config must define a non-empty "mounter" string');
    }

    const entries = await discoverPreviewEntries(runtime.data.components);
    tempDir = await mkdtemp(path.join(os.tmpdir(), "bit-lite-webpack-preview-"));
    const generated = await createWebpackEntries(entries, previewRuntime, vendorConfig, tempDir);
    const userConfig = await importWebpackConfig(vendorConfig.configFile);
    const compiler = webpack(createWebpackConfig(userConfig, workspaceRoot, previewRuntime, tempDir, generated.entries));
    if (!compiler) throw new Error("Webpack did not create a compiler");

    middleware = webpackDevMiddleware(compiler, {
      publicPath: webpackPublicPath(previewRuntime),
      stats: "errors-warnings",
    }) as WebpackPreviewMiddleware;

    server = http.createServer((request, response) => {
      if (request.method !== "GET" || request.url === undefined) {
        response.statusCode = 405;
        response.end("Method not allowed");
        return;
      }

      const route = matchPreviewRoute(request.url, previewRuntime.basePath, entries);
      if (!route) {
        (middleware as WebpackPreviewMiddlewareHandler | undefined)?.(request, response, () => {
          response.statusCode = 404;
          response.end("Not found");
        });
        return;
      }

      if (route.kind === "docs") {
        sendHtml(response, route.entry.docs ? 200 : 404, renderDocsPage(route.entry, previewRuntime));
        return;
      }

      if (route.kind === "compositions-list") {
        sendHtml(response, 200, renderCompositionsPage(route.entry, previewRuntime));
        return;
      }

      const composition = route.entry.compositions.find((candidate) => candidate.id === route.compositionId);
      const bundle = generated.bundles.find((candidate) => {
        return candidate.componentId === route.entry.component.id && candidate.compositionId === route.compositionId;
      });
      sendHtml(
        response,
        composition && bundle ? 200 : 404,
        composition && bundle
          ? renderWebpackCompositionPage(route.entry, composition, previewRuntime, bundle)
          : renderMessagePage("Composition not found", `${route.entry.component.id}/${route.compositionId}`)
      );
    });

    await listen(server, previewRuntime.host, previewRuntime.port);
    await waitUntilValid(middleware);

    const data = createPreviewServiceResult(previewRuntime, runtime.data.envName, meta.id);
    runtime.postMessage({ type: "result", data });
    runtime.postMessage({ type: "status", status: "ready" });
    return { stop };
  } catch (error) {
    runtime.postMessage({ type: "status", status: "error" });
    await stop().catch(() => undefined);
    throw error;
  }

  async function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      if (stopped) return;
      stopped = true;
      const activeServer = server;
      const activeMiddleware = middleware;
      const activeTempDir = tempDir;
      server = undefined;
      middleware = undefined;
      tempDir = undefined;
      await closeMiddleware(activeMiddleware);
      await closeServer(activeServer);
      if (activeTempDir) await rm(activeTempDir, { recursive: true, force: true });
      runtime.postMessage({ type: "status", status: "stopped" });
      unsubscribe();
    })();
    return stopping;
  }
}

async function createWebpackEntries(
  entries: PreviewComponentEntry[],
  runtime: PreviewVendorRuntime,
  vendorConfig: PreviewVendorConfig,
  tempDir: string
) {
  const webpackEntries: EntryObject = {};
  const bundles: WebpackPreviewBundle[] = [];
  let index = 0;

  for (const entry of entries) {
    for (const composition of entry.compositions) {
      const entryName = `composition-${index}`;
      const entryFile = path.join(tempDir, `${entryName}.mjs`);
      await writeFile(entryFile, createWebpackEntrySource(entry, composition, vendorConfig.mounter ?? ""), "utf8");
      webpackEntries[entryName] = entryFile;
      bundles.push({
        componentId: entry.component.id,
        compositionId: composition.id,
        entryName,
        scriptRoute: `${webpackPublicPath(runtime)}${entryName}.js`,
      });
      index += 1;
    }
  }

  return {
    entries: webpackEntries,
    bundles,
  };
}

function createWebpackEntrySource(
  entry: PreviewComponentEntry,
  composition: PreviewCompositionEntry,
  mounter: string
) {
  const context = JSON.stringify({ componentId: entry.component.id, compositionId: composition.id });

  return `
import * as compositionModule from ${JSON.stringify(toWebpackImportSpecifier(composition.filePath))};
import mountPreviewComposition from ${JSON.stringify(toWebpackImportSpecifier(mounter))};

const root = document.getElementById("preview-root");
const composition = compositionModule.default ?? compositionModule;
Promise.resolve(mountPreviewComposition(composition, root, ${context})).catch((error) => {
  if (root) root.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
});
`;
}

function createWebpackConfig(
  userConfig: Configuration,
  workspaceRoot: string,
  runtime: PreviewVendorRuntime,
  tempDir: string,
  entries: EntryObject
): Configuration {
  return {
    ...userConfig,
    mode: userConfig.mode ?? "development",
    context: userConfig.context ?? workspaceRoot,
    devtool: userConfig.devtool ?? "eval-cheap-module-source-map",
    entry: entries,
    output: {
      ...(userConfig.output ?? {}),
      path: path.join(tempDir, "dist"),
      publicPath: webpackPublicPath(runtime),
      filename: "[name].js",
    },
  };
}

async function importWebpackConfig(configFile: string): Promise<Configuration> {
  const moduleUrl = path.isAbsolute(configFile) ? pathToFileURL(configFile).href : configFile;
  const configModule = (await import(moduleUrl)) as { default?: unknown };
  const config = typeof configModule.default === "function" ? await configModule.default() : configModule.default;
  if (!isRecord(config)) throw new Error(`Webpack config "${configFile}" must default export an object`);
  return config as Configuration;
}

function renderWebpackCompositionPage(
  entry: PreviewComponentEntry,
  composition: PreviewCompositionEntry,
  runtime: PreviewVendorRuntime,
  bundle: WebpackPreviewBundle
) {
  return renderCompositionHostPage(
    entry,
    composition,
    runtime,
    `<script defer src="${bundle.scriptRoute}"></script>`
  );
}

function webpackPublicPath(runtime: PreviewVendorRuntime) {
  return `${runtime.basePath}__bit-lite/webpack/`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isServerNotRunningError(error: Error | undefined) {
  return error !== undefined && "code" in error && error.code === "ERR_SERVER_NOT_RUNNING";
}

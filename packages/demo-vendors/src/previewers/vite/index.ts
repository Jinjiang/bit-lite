import { createServer, type ViteDevServer } from "vite";
import type { VendorDefinition, VendorRuntime, VendorStartResult } from "bit-lite-vendors";
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
  toBrowserImportSpecifier,
  type PreviewComponentEntry,
  type PreviewServiceResult,
  type PreviewVendorConfig,
  type PreviewVendorRuntime,
} from "../core.js";

export const meta: VendorDefinition = {
  id: "vite-preview",
  label: "Vite Preview",
  hint: "Serve component docs and compositions with Vite",
  moduleUrl: import.meta.url,
};

export default async function startVitePreviewVendor(
  runtime: VendorRuntime<Record<string, unknown>, PreviewServiceResult, never, PreviewVendorRuntime>
): Promise<VendorStartResult<PreviewServiceResult>> {
  const workspaceRoot = runtime.data.context?.workspaceRoot ?? process.cwd();
  const previewRuntime = readPreviewRuntime(runtime.data.runtime);
  const vendorConfig = readPreviewVendorConfig(runtime.data.config, workspaceRoot);
  let server: ViteDevServer | undefined;
  let stopped = false;
  let stopping: Promise<void> | undefined;

  const unsubscribe = runtime.onMessage(async (message) => {
    if (isShutdownMessage(message)) await stop();
  });

  runtime.postMessage({ type: "ready" });
  runtime.postMessage({ type: "status", status: "building" });

  try {
    const entries = await discoverPreviewEntries(runtime.data.components);
    server = await createServer({
      root: workspaceRoot,
      configFile: vendorConfig.configFile,
      base: previewRuntime.basePath,
      appType: "custom",
      server: {
        host: previewRuntime.host,
        port: previewRuntime.port,
        strictPort: true,
        hmr: createHmrOptions(previewRuntime),
      },
    });

    installPreviewRoutes(server, previewRuntime, vendorConfig, entries);
    await server.listen(previewRuntime.port);

    const data = createPreviewServiceResult(previewRuntime, runtime.data.envName, meta.id);
    runtime.postMessage({ type: "result", data });
    runtime.postMessage({ type: "status", status: "ready" });
    return { stop };
  } catch (error) {
    runtime.postMessage({ type: "status", status: "error" });
    await stop();
    throw error;
  }

  async function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      if (stopped) return;
      stopped = true;
      const activeServer = server;
      server = undefined;
      await activeServer?.close();
      runtime.postMessage({ type: "status", status: "stopped" });
      unsubscribe();
    })();
    return stopping;
  }
}

function installPreviewRoutes(
  server: ViteDevServer,
  previewRuntime: PreviewVendorRuntime,
  vendorConfig: PreviewVendorConfig,
  entries: PreviewComponentEntry[]
) {
  server.middlewares.use(async (request, response, next) => {
    if (request.method !== "GET" || request.url === undefined) {
      next();
      return;
    }

    const route = matchPreviewRoute(request.url, previewRuntime.basePath, entries);
    if (!route) {
      next();
      return;
    }

    if (route.kind === "docs") {
      await sendPreviewHtml(
        server,
        request.url,
        response,
        route.entry.docs ? 200 : 404,
        renderDocsPage(route.entry, previewRuntime)
      );
      return;
    }

    if (route.kind === "compositions-list") {
      await sendPreviewHtml(server, request.url, response, 200, renderCompositionsPage(route.entry, previewRuntime));
      return;
    }

    const composition = route.entry.compositions.find((candidate) => candidate.id === route.compositionId);
    await sendPreviewHtml(
      server,
      request.url,
      response,
      composition && vendorConfig.mounter ? 200 : composition ? 500 : 404,
      !composition
        ? renderMessagePage("Composition not found", `${route.entry.component.id}/${route.compositionId}`)
        : vendorConfig.mounter
          ? renderViteCompositionPage(route.entry, composition, previewRuntime, vendorConfig.mounter)
          : renderMessagePage("Preview mounter missing", "This env preview config must define config.mounter.")
    );
  });
}

async function sendPreviewHtml(
  server: ViteDevServer,
  url: string,
  response: { statusCode: number; setHeader(name: string, value: string): void; end(content: string): void },
  statusCode: number,
  html: string
) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(await server.transformIndexHtml(url, html));
}

function renderViteCompositionPage(
  entry: PreviewComponentEntry,
  composition: { id: string; title: string; filePath: string },
  runtime: PreviewVendorRuntime,
  mounter: string
) {
  const context = JSON.stringify({ componentId: entry.component.id, compositionId: composition.id });

  return renderCompositionHostPage(
    entry,
    composition,
    runtime,
    `<script type="module">
import * as compositionModule from ${JSON.stringify(toBrowserImportSpecifier(composition.filePath))};
import mountPreviewComposition from ${JSON.stringify(toBrowserImportSpecifier(mounter))};
const root = document.getElementById("preview-root");
const composition = compositionModule.default ?? compositionModule;
const cleanup = await mountPreviewComposition(composition, root, ${context});
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    if (typeof cleanup === "function") cleanup();
  });
}
</script>`
  );
}

function createHmrOptions(runtime: PreviewVendorRuntime) {
  const proxy = new URL(runtime.proxyOrigin);
  return {
    host: proxy.hostname,
    clientPort: proxy.port ? Number(proxy.port) : proxy.protocol === "https:" ? 443 : 80,
    protocol: proxy.protocol === "https:" ? "wss" as const : "ws" as const,
  };
}

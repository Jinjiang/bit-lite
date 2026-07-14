import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import type { VendorDefinition, VendorRuntime, VendorStartResult } from "bit-lite-vendors";
import {
  createPreviewServiceResult,
  isShutdownMessage,
  readPreviewRuntime,
  readPreviewVendorConfig,
  withPreviewVendorContext,
  type PreviewServiceResult,
  type PreviewVendorRuntime,
} from "../core.js";

export const meta: VendorDefinition = {
  id: "vite-preview",
  label: "Vite Preview",
  hint: "Serve a command-prepared preview entry with Vite",
  moduleUrl: import.meta.url,
};

export default async function startVitePreviewVendor(
  runtime: VendorRuntime<Record<string, unknown>, PreviewServiceResult, never, PreviewVendorRuntime>
): Promise<VendorStartResult<PreviewServiceResult>> {
  const workspaceRoot = runtime.data.context?.workspaceRoot ?? process.cwd();
  const previewRuntime = readPreviewRuntime(runtime.data.runtime);
  const vendorConfig = readPreviewVendorConfig(runtime.data.config);
  let server: ViteDevServer | undefined;
  let stopped = false;
  let stopping: Promise<void> | undefined;

  const unsubscribe = runtime.onMessage(async (message) => {
    if (isShutdownMessage(message)) await stop();
  });

  runtime.postMessage({ type: "ready" });
  runtime.postMessage({ type: "status", status: "building" });

  try {
    const html = await readFile(previewRuntime.prepared.htmlFile, "utf8");
    server = await createServer({
      root: workspaceRoot,
      configFile: vendorConfig.configFile,
      base: previewRuntime.server.basePath,
      appType: "custom",
      plugins: [createPreparedPreviewPlugin(previewRuntime, html)],
      server: {
        host: previewRuntime.server.host,
        port: previewRuntime.server.port,
        strictPort: true,
        preTransformRequests: false,
        hmr: createHmrOptions(previewRuntime),
      },
    });
    await server.listen();

    const data = createPreviewServiceResult(previewRuntime, runtime.data.envName, meta.id);
    runtime.postMessage({ type: "result", data });
    runtime.postMessage({ type: "status", status: "ready" });
    return { stop };
  } catch (error) {
    runtime.postMessage({ type: "status", status: "error" });
    await stop().catch(() => undefined);
    throw withPreviewVendorContext(error, runtime.data.envName, meta.id);
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

function createPreparedPreviewPlugin(runtime: PreviewVendorRuntime, html: string): Plugin {
  const entryRoute = `${runtime.server.basePath}__bit-lite/preview.js`;
  const entryRoutes = new Set([entryRoute, "/__bit-lite/preview.js"]);
  const htmlRoutes = new Set([runtime.server.basePath, `${runtime.server.basePath}index.html`, "/", "/index.html"]);

  return {
    name: "bit-lite-prepared-preview",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== "GET" || !request.url) {
          next();
          return;
        }
        const url = new URL(request.url, "http://bit-lite-preview.local");
        if (entryRoutes.has(url.pathname)) {
          try {
            const result = await server.transformRequest(`/@fs${toPosixPath(runtime.prepared.entryFile)}${url.search}`);
            if (!result) {
              next();
              return;
            }
            response.statusCode = 200;
            response.setHeader("content-type", "text/javascript; charset=utf-8");
            response.end(result.code);
          } catch (error) {
            next(error);
          }
          return;
        }
        if (!htmlRoutes.has(url.pathname)) {
          next();
          return;
        }

        try {
          response.statusCode = 200;
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end(await server.transformIndexHtml(request.url, html));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

function createHmrOptions(runtime: PreviewVendorRuntime) {
  const proxy = new URL(runtime.server.proxyOrigin);
  return {
    host: proxy.hostname,
    clientPort: proxy.port ? Number(proxy.port) : proxy.protocol === "https:" ? 443 : 80,
    protocol: proxy.protocol === "https:" ? ("wss" as const) : ("ws" as const),
    path: runtime.server.basePath,
  };
}

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

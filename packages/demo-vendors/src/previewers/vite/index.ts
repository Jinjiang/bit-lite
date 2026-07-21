import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import type { JsonObject, VendorDefinition, VendorRuntime, VendorStartResult } from "bit-lite-vendors";
import {
  createPreviewServiceResult,
  isShutdownMessage,
  readPreviewConfigFile,
  readPreviewRuntime,
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
  runtime: VendorRuntime<JsonObject, PreviewServiceResult, never, PreviewVendorRuntime>
): Promise<VendorStartResult<PreviewServiceResult>> {
  const previewRuntime = readPreviewRuntime(runtime.data.runtime);
  const workspaceRoot = runtime.data.context.workspace.rootDir;
  const configFile = readPreviewConfigFile(runtime.data.config);
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
    server = await startVitePreviewServer(previewRuntime, workspaceRoot, configFile, html);

    const data = createPreviewServiceResult(readViteServerPort(server));
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
      server = undefined;
      await activeServer?.close();
      runtime.postMessage({ type: "status", status: "stopped" });
      unsubscribe();
    })();
    return stopping;
  }
}

async function startVitePreviewServer(
  runtime: PreviewVendorRuntime,
  workspaceRoot: string,
  configFile: string,
  html: string
) {
  try {
    return await startOnPort(runtime.server.preferredPort);
  } catch (error) {
    if (!isPortUnavailableError(error)) throw error;
  }

  for (let port = runtime.server.fallbackStartPort; port <= 65535; port += 1) {
    try {
      return await startOnPort(port);
    } catch (error) {
      if (!isPortUnavailableError(error)) throw error;
    }
  }
  throw new Error(`No available preview port found at or after ${runtime.server.fallbackStartPort}`);

  async function startOnPort(port: number) {
    const candidate = await createServer({
      root: workspaceRoot,
      cacheDir: createVitePreviewCacheDir(runtime, workspaceRoot),
      configFile,
      base: runtime.server.basePath,
      appType: "custom",
      plugins: [createPreparedPreviewVitePlugin(runtime, html)],
      resolve: { alias: createViteWorkspaceAliases(runtime) },
      optimizeDeps: {
        entries: [runtime.prepared.entryFile],
      },
      server: {
        host: runtime.server.host,
        port,
        strictPort: true,
        preTransformRequests: false,
        hmr: createHmrOptions(runtime),
      },
    });
    try {
      await candidate.listen();
      return candidate;
    } catch (error) {
      await candidate.close().catch(() => undefined);
      throw error;
    }
  }
}

function readViteServerPort(server: ViteDevServer) {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string" || !Number.isInteger(address.port) || address.port <= 0) {
    throw new Error("Vite preview server did not expose its actual bound port");
  }
  return address.port;
}

function isPortUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ("code" in error && error.code === "EADDRINUSE") return true;
  if (/port \d+ is already in use/i.test(error.message)) return true;
  return "cause" in error && isPortUnavailableError(error.cause);
}

export function createViteWorkspaceAliases(runtime: PreviewVendorRuntime) {
  return runtime.aliases.map(({ packageName, sourceDir }) => ({
    find: packageName,
    replacement: sourceDir,
  }));
}

export function createVitePreviewCacheDir(runtime: PreviewVendorRuntime, workspaceRoot: string) {
  return path.join(
    workspaceRoot,
    ".bit-lite",
    "vite-preview",
    sanitizeFileName(runtime.server.basePath)
  );
}

/**
 * Maps the stable public preview URLs to the command-prepared files, while
 * still passing both files through Vite's HTML and module transform pipelines.
 * Those transforms are what inject the Vite client, apply user plugins, and
 * connect the generated entry to HMR.
 */
function createPreparedPreviewVitePlugin(runtime: PreviewVendorRuntime, html: string): Plugin {
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
  };
}

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "env";
}

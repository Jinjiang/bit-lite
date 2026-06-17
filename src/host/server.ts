import { readFile } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PreviewEntry, PreviewResult } from "../types/services/preview.js";

export type HostView = {
  type: string;
  label: string;
  url: string;
};

export type HostTestState = {
  envName?: string;
  status?: string;
  exitCode?: number;
  output?: string;
  envs?: HostTestState[];
};

type RegisteredPreview = {
  envName: string;
  vendor: string;
  host: string;
  port: number;
  base: string;
  url: string;
  components: Array<PreviewEntry & { views: HostView[] }>;
};

export type PreviewHost = {
  url: string;
  registerPreview(envName: string, result: PreviewResult, options?: RegisterPreviewOptions): void;
  setTestProvider(provider: (envName?: string) => HostTestState): void;
  stop(): Promise<void>;
};

export type RegisterPreviewOptions = {
  docs?: boolean;
  source?: boolean;
  tests?: boolean;
};

const DEFAULT_CENTRAL_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";

export async function createPreviewHost(options: { title: string }): Promise<PreviewHost> {
  const previews = new Map<string, RegisteredPreview>();
  let testProvider: ((envName?: string) => HostTestState) | undefined;
  const host = DEFAULT_HOST;
  const port = DEFAULT_CENTRAL_PORT;
  const url = `http://${host}:${port}/`;
  const server = createHttpServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      sendText(res, 500, message);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    url,
    registerPreview(envName, result, registerOptions = {}) {
      if (!result.host || !result.port || !result.base || !result.url || !result.entries || !result.vendor) return;
      previews.set(envName, {
        envName,
        vendor: result.vendor,
        host: result.host,
        port: result.port,
        base: result.base,
        url: result.url,
        components: result.entries.map((entry) => ({
          ...entry,
          views: createViews(envName, result.base ?? "", entry, registerOptions),
        })),
      });
    },
    setTestProvider(provider) {
      testProvider = provider;
    },
    stop() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    if (!req.url) {
      sendText(res, 404, "not found");
      return;
    }
    const parsed = new URL(req.url, url);
    if (parsed.pathname === "/") {
      await sendAsset(res, "index.html");
      return;
    }
    if (parsed.pathname === "/api/previews") {
      sendJson(res, getRegistry());
      return;
    }
    if (parsed.pathname === "/api/tests") {
      if (!testProvider) {
        sendText(res, 404, "tests are not registered");
        return;
      }
      sendJson(res, testProvider(parsed.searchParams.get("env") ?? undefined));
      return;
    }
    if (parsed.pathname === "/tests") {
      if (!testProvider) {
        sendText(res, 404, "tests are not registered");
        return;
      }
      await sendAsset(res, "tests.html");
      return;
    }
    const envMatch = parsed.pathname.match(/^\/env\/([^/]+)(\/.*)?$/);
    if (envMatch) {
      proxyEnvRequest(req, res, decodeURIComponent(envMatch[1] ?? ""));
      return;
    }
    sendText(res, 404, "not found");
  }

  function getRegistry() {
    const envs = Array.from(previews.values()).sort((left, right) => left.envName.localeCompare(right.envName));
    return {
      title: options.title,
      envs: envs.map((env) => ({
        envName: env.envName,
        vendor: env.vendor,
        url: env.url,
        proxyBase: env.base,
        components: env.components.map((component) => ({
          id: component.id,
          rootDir: component.rootDir,
          views: component.views,
        })),
      })),
    };
  }

  function proxyEnvRequest(req: IncomingMessage, res: ServerResponse, envName: string) {
    const env = previews.get(envName);
    if (!env || !req.url) {
      sendText(res, 404, `preview env "${envName}" is not running`);
      return;
    }
    const proxyReq = httpRequest(
      {
        hostname: env.host,
        port: env.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on("error", (error) => {
      sendText(res, 502, `failed proxying "${envName}": ${error.message}`);
    });
    req.pipe(proxyReq);
  }
}

function createViews(envName: string, base: string, entry: PreviewEntry, options: RegisterPreviewOptions) {
  const component = encodeURIComponent(entry.id);
  const views: HostView[] = [
    {
      type: "preview",
      label: "Demo",
      url: `${base}?component=${component}&view=preview`,
    },
  ];
  if (options.docs && entry.docsFile) {
    views.push({
      type: "docs",
      label: "Docs",
      url: `${base}?component=${component}&view=docs`,
    });
  }
  if (options.source && entry.sourceFile) {
    views.push({
      type: "source",
      label: "Source",
      url: `${base}?component=${component}&view=source`,
    });
  }
  if (options.tests) {
    views.push({
      type: "tests",
      label: "Tests",
      url: `/tests?env=${encodeURIComponent(envName)}&component=${component}`,
    });
  }
  return views;
}

async function sendAsset(res: ServerResponse, name: string) {
  const body = await readAsset(name);
  sendHtml(res, body);
}

async function readAsset(name: string) {
  const distPath = fileURLToPath(new URL(`./assets/${name}`, import.meta.url));
  try {
    return await readFile(distPath, "utf8");
  } catch {
    return readFile(path.join(process.cwd(), "src/host/assets", name), "utf8");
  }
}

function sendHtml(res: ServerResponse, body: string) {
  res.writeHead(200, { "content-type": "text/html; charset=utf8" });
  res.end(body);
}

function sendJson(res: ServerResponse, body: unknown) {
  res.writeHead(200, { "content-type": "application/json; charset=utf8" });
  res.end(JSON.stringify(body, null, 2));
}

function sendText(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf8" });
  res.end(body);
}

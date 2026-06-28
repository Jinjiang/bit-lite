import { readFile } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type HostView = {
  type: string;
  label: string;
  url: string;
};

export type HostRegistryComponent = {
  id: string;
  rootDir: string;
  views: HostView[];
};

export type HostRegistrySection = {
  key: string;
  title: string;
  subtitle?: string;
  url?: string;
  components: HostRegistryComponent[];
  [metadata: string]: unknown;
};

export type HostRouteContext = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  sendAsset(name: string): Promise<void>;
  sendHtml(body: string): void;
  sendJson(body: unknown): void;
  sendText(status: number, body: string): void;
};

export type HostRoute = {
  method?: string;
  path: string | RegExp;
  handler(context: HostRouteContext): Promise<void> | void;
};

export type HostProxy = {
  pathPrefix: string;
  host: string;
  port: number;
};

export type CommandHost = {
  url: string;
  registerRegistrySection(section: HostRegistrySection): void;
  registerRoute(route: HostRoute): void;
  registerProxy(proxy: HostProxy): void;
  stop(): Promise<void>;
};

const DEFAULT_CENTRAL_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";

export async function createCommandHost(options: { title: string }): Promise<CommandHost> {
  const registrySections = new Map<string, HostRegistrySection>();
  const routes: HostRoute[] = [];
  const proxies: HostProxy[] = [];
  const host = DEFAULT_HOST;
  const port = DEFAULT_CENTRAL_PORT;
  const url = `http://${host}:${port}/`;
  const server = createHttpServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      sendText(res, 500, message);
    });
  });

  await listen(server, port, host);

  return {
    url,
    registerRegistrySection(section) {
      registrySections.set(section.key, section);
    },
    registerRoute(route) {
      routes.push(route);
    },
    registerProxy(proxy) {
      proxies.push({
        ...proxy,
        pathPrefix: normalizePathPrefix(proxy.pathPrefix),
      });
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
    if (parsed.pathname === "/api/registry") {
      sendJson(res, getRegistry());
      return;
    }

    const route = routes.find((candidate) => matchesRoute(candidate, req.method, parsed.pathname));
    if (route) {
      await route.handler({
        req,
        res,
        url: parsed,
        sendAsset: (name) => sendAsset(res, name),
        sendHtml: (body) => sendHtml(res, body),
        sendJson: (body) => sendJson(res, body),
        sendText: (status, body) => sendText(res, status, body),
      });
      return;
    }

    const proxy = proxies.find((candidate) => matchesProxy(candidate, parsed.pathname));
    if (proxy) {
      proxyRequest(req, res, proxy);
      return;
    }

    sendText(res, 404, "not found");
  }

  function getRegistry() {
    return {
      title: options.title,
      sections: Array.from(registrySections.values()).sort((left, right) => left.title.localeCompare(right.title)),
    };
  }
}

function listen(server: HttpServer, port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function matchesRoute(route: HostRoute, method: string | undefined, pathname: string) {
  if (route.method && route.method.toUpperCase() !== method?.toUpperCase()) return false;
  if (typeof route.path === "string") return route.path === pathname;
  return route.path.test(pathname);
}

function matchesProxy(proxy: HostProxy, pathname: string) {
  const prefix = normalizePathPrefix(proxy.pathPrefix);
  return pathname === prefix.slice(0, -1) || pathname.startsWith(prefix);
}

function normalizePathPrefix(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function proxyRequest(req: IncomingMessage, res: ServerResponse, proxy: HostProxy) {
  if (!req.url) {
    sendText(res, 404, "not found");
    return;
  }
  const proxyReq = httpRequest(
    {
      hostname: proxy.host,
      port: proxy.port,
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
    sendText(res, 502, `failed proxying "${proxy.pathPrefix}": ${error.message}`);
  });
  req.pipe(proxyReq);
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

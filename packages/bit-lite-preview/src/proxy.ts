import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { getSelectedEnvKey } from "bit-lite-context";
import type { SelectedEnvIdentity } from "bit-lite-context";
import type { PreparedPreviewComponent } from "./preparation.js";

const previewShellHtml = readFileSync(new URL("./assets/preview-shell.html", import.meta.url), "utf8");
const previewMessageTemplate = readFileSync(new URL("./assets/preview-message.html", import.meta.url), "utf8");

export type PreviewServerInfo = {
  origin: string;
  host: string;
  port: number;
  basePath: string;
};

export type PreviewProxyComponent = {
  componentId: string;
  overviewRoute: string;
  docsRoute?: string;
  compositions: Array<{ id: string; exportName: string; name: string; route: string }>;
};

export type PreviewEnvState = {
  env: SelectedEnvIdentity;
  taskId: string;
  vendor: string;
  status: string;
  error?: string | undefined;
  server?: PreviewServerInfo | undefined;
  components: PreviewProxyComponent[];
};

export type PreviewSkippedEnv = {
  env: SelectedEnvIdentity;
  reason: string;
  components: string[];
};

export type PreviewProxyManifest = {
  proxy: {
    origin: string;
    host: string;
    port: number;
  };
  envs: PreviewEnvState[];
  skipped: PreviewSkippedEnv[];
};

export class PreviewProxyServer {
  #envs = new Map<string, PreviewEnvState>();
  #server: http.Server | undefined;
  #sockets = new Set<Socket>();
  #skipped: PreviewSkippedEnv[];
  #origin = "";
  #host = "";
  #port = 0;

  constructor(options: {
    envs: Array<{
      env: SelectedEnvIdentity;
      taskId: string;
      vendor: string;
      status: string;
      components: Array<{ id: string }>;
    }>;
    skipped: PreviewSkippedEnv[];
  }) {
    this.#skipped = options.skipped;
    for (const env of options.envs) {
      this.#envs.set(getSelectedEnvKey(env.env), {
        env: env.env,
        taskId: env.taskId,
        vendor: env.vendor,
        status: env.status,
        components: env.components.map((component) => ({
          componentId: component.id,
          overviewRoute: `/env/${encodeRouteSegment(env.env.packageName)}/#${encodeRouteSegment(component.id)}`,
          compositions: [],
        })),
      });
    }
  }

  get origin() {
    return this.#origin;
  }

  async start(host: string, preferredPort: number) {
    if (this.#server) return this.manifest().proxy;

    const server = http.createServer((request, response) => {
      void this.#handleRequest(request, response);
    });
    server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.once("close", () => this.#sockets.delete(socket));
    });
    server.on("upgrade", (request, socket, head) => {
      this.#handleUpgrade(request, socket, head);
    });

    const port = await listenOnAvailablePort(server, host, preferredPort);
    this.#server = server;
    this.#host = host;
    this.#port = port;
    this.#origin = `http://${host}:${port}`;
    return this.manifest().proxy;
  }

  updateTask(envIdentity: SelectedEnvIdentity, updates: Partial<Pick<PreviewEnvState, "taskId" | "vendor" | "status">>) {
    const env = this.#envs.get(getSelectedEnvKey(envIdentity));
    if (env) Object.assign(env, updates);
  }

  updateServer(envIdentity: SelectedEnvIdentity, server: PreviewServerInfo, vendor: string) {
    const env = this.#envs.get(getSelectedEnvKey(envIdentity));
    if (!env) return;
    env.status = "ready";
    env.vendor = vendor;
    env.server = server;
  }

  updatePreparedComponents(envIdentity: SelectedEnvIdentity, basePath: string, components: PreparedPreviewComponent[]) {
    const env = this.#envs.get(getSelectedEnvKey(envIdentity));
    if (!env) return;
    env.components = components.map((component) => createProxyComponent(basePath, component));
  }

  updatePreparationFailure(envIdentity: SelectedEnvIdentity, error: unknown) {
    const env = this.#envs.get(getSelectedEnvKey(envIdentity));
    if (!env) return;
    env.status = "failed";
    env.error = formatError(error);
    env.server = undefined;
  }

  manifest(): PreviewProxyManifest {
    return {
      proxy: { origin: this.#origin, host: this.#host, port: this.#port },
      envs: Array.from(this.#envs.values()).sort((left, right) => getSelectedEnvKey(left.env).localeCompare(
        getSelectedEnvKey(right.env)
      )),
      skipped: [...this.#skipped].sort((left, right) => getSelectedEnvKey(left.env).localeCompare(
        getSelectedEnvKey(right.env)
      )),
    };
  }

  async close() {
    const server = this.#server;
    if (!server) return;
    this.#server = undefined;
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async #handleRequest(request: IncomingMessage, response: ServerResponse) {
    const path = readRequestPath(request, this.#origin);
    if (path === "/") {
      sendHtml(response, 200, renderShellHtml());
      return;
    }
    if (path === "/__bit-lite/manifest.json") {
      sendJson(response, this.manifest());
      return;
    }

    const envPackageName = readEnvPackageName(path);
    const env = envPackageName ? this.#findEnvByPackageName(envPackageName) : undefined;
    if (!envPackageName || !env) {
      sendHtml(response, 404, renderMessagePage("Not found", "This preview route is not registered."));
      return;
    }
    if (!env.server) {
      response.setHeader("Retry-After", "1");
      sendHtml(
        response,
        503,
        renderMessagePage(
          env.status === "failed" ? "Preview preparation failed" : "Preview is starting",
          env.error ?? `${env.env.packageName} is ${env.status}.`
        )
      );
      return;
    }

    proxyHttpRequest(request, response, env.server).catch((error) => {
      if (!response.headersSent) sendHtml(response, 502, renderMessagePage("Preview proxy failed", formatError(error)));
      else response.destroy(error instanceof Error ? error : undefined);
    });
  }

  #handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const envPackageName = readEnvPackageName(readRequestPath(request, this.#origin));
    const env = envPackageName ? this.#findEnvByPackageName(envPackageName) : undefined;
    if (!env?.server) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    proxyWebSocket(request, socket, head, env.server);
  }

  #findEnvByPackageName(packageName: string) {
    return Array.from(this.#envs.values()).find((env) => env.env.packageName === packageName);
  }
}

export async function findAvailablePort(host: string, startPort: number) {
  for (let port = startPort; port <= 65535; port += 1) {
    if (await canListen(host, port)) return port;
  }
  throw new Error(`No available port found at or after ${startPort}`);
}

export function encodeRouteSegment(value: string) {
  return encodeURIComponent(value);
}

async function listenOnAvailablePort(server: http.Server, host: string, startPort: number) {
  let lastError: unknown;
  for (let port = startPort; port <= 65535; port += 1) {
    try {
      await listen(server, host, port);
      return port;
    } catch (error) {
      lastError = error;
      if (!isAddressInUse(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`No available port found at or after ${startPort}`);
}

async function canListen(host: string, port: number) {
  const server = net.createServer();
  try {
    await listen(server, host, port);
    return true;
  } catch (error) {
    if (isAddressInUse(error)) return false;
    throw error;
  } finally {
    server.close();
  }
}

function listen(server: http.Server | net.Server, host: string, port: number) {
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

function createProxyComponent(basePath: string, component: PreparedPreviewComponent): PreviewProxyComponent {
  return {
    componentId: component.component.id,
    overviewRoute: `${basePath}${createHashRoute(component.component.id)}`,
    ...(component.docs ? { docsRoute: `${basePath}${component.docs.route}` } : {}),
    compositions: component.compositions.map((composition) => ({
      id: composition.id,
      exportName: composition.exportName,
      name: composition.name,
      route: `${basePath}${composition.route}`,
    })),
  };
}

function createHashRoute(componentId: string) {
  return `#${encodeURIComponent(componentId)}`;
}

function proxyHttpRequest(request: IncomingMessage, response: ServerResponse, server: PreviewServerInfo) {
  const target = new URL(server.origin);
  return new Promise<void>((resolve, reject) => {
    const targetRequest = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, host: target.host },
      },
      (targetResponse) => {
        response.writeHead(targetResponse.statusCode ?? 502, targetResponse.statusMessage, targetResponse.headers);
        targetResponse.pipe(response);
        targetResponse.on("end", resolve);
      }
    );
    targetRequest.on("error", reject);
    request.pipe(targetRequest);
  });
}

function proxyWebSocket(request: IncomingMessage, sourceSocket: Duplex, head: Buffer, server: PreviewServerInfo) {
  const target = new URL(server.origin);
  const targetSocket = net.connect(Number(target.port), target.hostname);
  targetSocket.on("connect", () => {
    targetSocket.write(`${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}\r\n`);
    writeUpgradeHeaders(request, target.host, targetSocket);
    targetSocket.write("\r\n");
    if (head.length > 0) targetSocket.write(head);
    sourceSocket.pipe(targetSocket).pipe(sourceSocket);
  });
  targetSocket.on("error", () => sourceSocket.destroy());
  sourceSocket.on("error", () => targetSocket.destroy());
  sourceSocket.on("close", () => targetSocket.destroy());
  targetSocket.on("close", () => sourceSocket.destroy());
}

function writeUpgradeHeaders(request: IncomingMessage, targetHost: string, socket: Socket) {
  let wroteHost = false;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    const value = request.rawHeaders[index + 1];
    if (!name || value === undefined) continue;
    if (name.toLowerCase() === "host") {
      socket.write(`Host: ${targetHost}\r\n`);
      wroteHost = true;
    } else {
      socket.write(`${name}: ${value}\r\n`);
    }
  }
  if (!wroteHost) socket.write(`Host: ${targetHost}\r\n`);
}

function readRequestPath(request: IncomingMessage, origin: string) {
  return new URL(request.url ?? "/", origin || "http://127.0.0.1").pathname;
}

function readEnvPackageName(pathname: string) {
  const parts = pathname.split("/");
  if (parts[1] !== "env" || !parts[2]) return undefined;
  try {
    return decodeURIComponent(parts[2]);
  } catch {
    return undefined;
  }
}

function sendJson(response: ServerResponse, data: unknown) {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data, null, 2));
}

function sendHtml(response: ServerResponse, statusCode: number, html: string) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(html);
}

function renderShellHtml() {
  return previewShellHtml;
}

function renderMessagePage(title: string, message: string) {
  return previewMessageTemplate
    .replaceAll("{{TITLE}}", escapeHtml(title))
    .replace("{{MESSAGE}}", escapeHtml(message));
}

function isAddressInUse(error: unknown) {
  return error instanceof Error && "code" in error && (error.code === "EADDRINUSE" || error.code === "EACCES");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return char;
    }
  });
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

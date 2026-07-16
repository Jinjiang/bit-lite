import http from "node:http";
import net from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";

export type ProxyEndpoint = {
  origin: string;
  host: string;
  port: number;
};

export type ProxyRouteContext = {
  url: URL;
  endpoint: ProxyEndpoint;
};

export type ProxyRoute = {
  id: string;
  matches(url: URL, request: IncomingMessage): boolean;
  handleHttp(request: IncomingMessage, response: ServerResponse, context: ProxyRouteContext): void | Promise<void>;
  handleUpgrade?(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    context: ProxyRouteContext
  ): void | Promise<void>;
};

export type ProxyTarget = {
  origin: string;
};

export class ProxyServer {
  #host = "";
  #origin = "";
  #port = 0;
  #routeIds = new Set<string>();
  #routes: ProxyRoute[] = [];
  #server: http.Server | undefined;
  #sockets = new Set<Socket>();

  get endpoint(): ProxyEndpoint {
    return { origin: this.#origin, host: this.#host, port: this.#port };
  }

  get origin() {
    return this.#origin;
  }

  addRoute(route: ProxyRoute) {
    if (this.#routeIds.has(route.id)) throw new Error(`Proxy route "${route.id}" is already registered`);
    this.#routeIds.add(route.id);
    this.#routes.push(route);
    return this;
  }

  addRoutes(routes: readonly ProxyRoute[]) {
    for (const route of routes) this.addRoute(route);
    return this;
  }

  async start(host: string, preferredPort: number): Promise<ProxyEndpoint> {
    if (this.#server) return this.endpoint;

    const server = http.createServer((request, response) => {
      void this.#handleRequest(request, response);
    });
    server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.once("close", () => this.#sockets.delete(socket));
    });
    server.on("upgrade", (request, socket, head) => {
      void this.#handleUpgrade(request, socket, head);
    });

    const port = await listenOnAvailablePort(server, host, preferredPort);
    this.#server = server;
    this.#host = host;
    this.#port = port;
    this.#origin = `http://${host}:${port}`;
    return this.endpoint;
  }

  async close() {
    const server = this.#server;
    if (!server) return;
    this.#server = undefined;
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async #handleRequest(request: IncomingMessage, response: ServerResponse) {
    const context = this.#createContext(request);
    const route = this.#routes.find((candidate) => candidate.matches(context.url, request));
    if (!route) {
      sendText(response, 404, "Not found");
      return;
    }

    try {
      await route.handleHttp(request, response, context);
    } catch (error) {
      if (!response.headersSent) sendText(response, 500, formatError(error));
      else response.destroy(error instanceof Error ? error : undefined);
    }
  }

  async #handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const context = this.#createContext(request);
    const route = this.#routes.find((candidate) => candidate.matches(context.url, request));
    if (!route?.handleUpgrade) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      await route.handleUpgrade(request, socket, head, context);
    } catch {
      socket.destroy();
    }
  }

  #createContext(request: IncomingMessage): ProxyRouteContext {
    const fallbackOrigin = this.#origin || "http://127.0.0.1";
    return {
      url: new URL(request.url ?? "/", fallbackOrigin),
      endpoint: this.endpoint,
    };
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

export function sendHtml(response: ServerResponse, status: number, html: string) {
  response.statusCode = status;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(html);
}

export function sendJson(response: ServerResponse, value: unknown, status = 200) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(value));
}

export function sendText(response: ServerResponse, status: number, value: string) {
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(value);
}

export function proxyHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  targetInfo: ProxyTarget
) {
  const target = new URL(targetInfo.origin);
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

export function proxyWebSocket(
  request: IncomingMessage,
  sourceSocket: Duplex,
  head: Buffer,
  targetInfo: ProxyTarget
) {
  const target = new URL(targetInfo.origin);
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

function writeUpgradeHeaders(request: IncomingMessage, targetHost: string, socket: Duplex) {
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

function isAddressInUse(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error.code === "EADDRINUSE" || error.code === "EACCES");
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

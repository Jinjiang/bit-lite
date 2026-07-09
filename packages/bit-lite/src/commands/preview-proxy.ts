import http from "node:http";
import net from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import type { ComponentRef } from "bit-lite-context";

export type PreviewServerInfo = {
  origin: string;
  host: string;
  port: number;
  basePath: string;
};

export type PreviewProxyComponent = {
  componentId: string;
  docsRoute: string;
  compositionsRoute: string;
};

export type PreviewEnvState = {
  envName: string;
  taskId: string;
  vendor: string;
  status: string;
  server?: PreviewServerInfo | undefined;
  components: PreviewProxyComponent[];
};

export type PreviewSkippedEnv = {
  envName: string;
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
    envs: Array<{ envName: string; taskId: string; vendor: string; status: string; components: ComponentRef[] }>;
    skipped: PreviewSkippedEnv[];
  }) {
    this.#skipped = options.skipped;
    for (const env of options.envs) {
      this.#envs.set(env.envName, {
        envName: env.envName,
        taskId: env.taskId,
        vendor: env.vendor,
        status: env.status,
        components: env.components.map((component) => createProxyComponent(env.envName, component)),
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

  updateTask(envName: string, updates: Partial<Pick<PreviewEnvState, "taskId" | "vendor" | "status">>) {
    const env = this.#envs.get(envName);
    if (env) Object.assign(env, updates);
  }

  updateServer(envName: string, server: PreviewServerInfo, vendor: string) {
    const env = this.#envs.get(envName);
    if (!env) return;
    env.status = "ready";
    env.vendor = vendor;
    env.server = server;
  }

  manifest(): PreviewProxyManifest {
    return {
      proxy: { origin: this.#origin, host: this.#host, port: this.#port },
      envs: Array.from(this.#envs.values()).sort((left, right) => left.envName.localeCompare(right.envName)),
      skipped: [...this.#skipped].sort((left, right) => left.envName.localeCompare(right.envName)),
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

    const envName = readEnvName(path);
    const env = envName ? this.#envs.get(envName) : undefined;
    if (!envName || !env) {
      sendHtml(response, 404, renderMessagePage("Not found", "This preview route is not registered."));
      return;
    }
    if (!env.server) {
      response.setHeader("Retry-After", "1");
      sendHtml(response, 503, renderMessagePage("Preview is starting", `${env.envName} is ${env.status}.`));
      return;
    }

    proxyHttpRequest(request, response, env.server).catch((error) => {
      if (!response.headersSent) sendHtml(response, 502, renderMessagePage("Preview proxy failed", formatError(error)));
      else response.destroy(error instanceof Error ? error : undefined);
    });
  }

  #handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const envName = readEnvName(readRequestPath(request, this.#origin));
    const env = envName ? this.#envs.get(envName) : undefined;
    if (!env?.server) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    proxyWebSocket(request, socket, head, env.server);
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

function createProxyComponent(envName: string, component: ComponentRef): PreviewProxyComponent {
  const componentRoute = `/env/${encodeRouteSegment(envName)}/${encodeRouteSegment(component.id)}`;
  return {
    componentId: component.id,
    docsRoute: `${componentRoute}/docs`,
    compositionsRoute: `${componentRoute}/compositions`,
  };
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

function readEnvName(pathname: string) {
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>bit-lite preview</title><style>body{margin:0;background:#f8fafc;color:#111827;font-family:Inter,ui-sans-serif,system-ui,sans-serif}main{width:min(1120px,calc(100vw - 32px));margin:0 auto;padding:32px 0 48px}header{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:24px}h1{margin:0;font-size:28px}.origin{color:#4b5563;font-size:14px}.env{background:#fff;border:1px solid #d1d5db;border-radius:8px;margin:14px 0;overflow:hidden}.env-head{display:flex;justify-content:space-between;gap:12px;padding:14px 16px;background:#f3f4f6;border-bottom:1px solid #d1d5db}.env-name{font-weight:700}.status{font-size:13px;color:#374151}.component{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:13px 16px;border-top:1px solid #e5e7eb}.component:first-child{border-top:0}.component-id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;overflow-wrap:anywhere}.links{display:flex;flex-wrap:wrap;gap:8px;justify-content:end}a{color:#0f766e;text-decoration:none;font-weight:600}a:hover{text-decoration:underline}.skipped{margin-top:24px;padding:16px;border:1px solid #f59e0b;border-radius:8px;background:#fffbeb}.empty{padding:18px 0;color:#6b7280}</style></head><body><main><header><div><h1>bit-lite preview</h1><div class="origin" id="origin"></div></div><a href="/__bit-lite/manifest.json">manifest</a></header><section id="app" class="empty">Loading preview manifest...</section></main><script>const app=document.getElementById("app");const origin=document.getElementById("origin");async function loadManifest(){const response=await fetch("/__bit-lite/manifest.json",{cache:"no-store"});const manifest=await response.json();origin.textContent=manifest.proxy.origin;app.className="";app.innerHTML=renderManifest(manifest)}function renderManifest(manifest){const envs=manifest.envs.map(renderEnv).join("")||'<div class="empty">No preview envs are running.</div>';const skipped=manifest.skipped.length>0?'<section class="skipped"><strong>Skipped envs</strong>'+manifest.skipped.map(renderSkipped).join("")+"</section>":"";return envs+skipped}function renderEnv(env){return '<article class="env"><div class="env-head"><span class="env-name">'+escapeHtml(env.envName)+'</span><span class="status">'+escapeHtml(env.vendor)+" · "+escapeHtml(env.status)+(env.server?" · "+escapeHtml(env.server.origin):"")+'</span></div><div class="components">'+env.components.map(renderComponent).join("")+"</div></article>"}function renderComponent(component){return '<div class="component"><span class="component-id">'+escapeHtml(component.componentId)+'</span><span class="links"><a href="'+component.docsRoute+'">docs</a><a href="'+component.compositionsRoute+'">compositions</a></span></div>'}function renderSkipped(env){return "<p><strong>"+escapeHtml(env.envName)+"</strong>: "+escapeHtml(env.reason)+" ("+env.components.map(escapeHtml).join(", ")+")</p>"}function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}loadManifest().catch(error=>{app.textContent=error instanceof Error?error.message:String(error)});setInterval(loadManifest,1500)</script></body></html>`;
}

function renderMessagePage(title: string, message: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="1"><title>${escapeHtml(title)}</title><style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#f8fafc;color:#111827;font-family:ui-sans-serif,system-ui,sans-serif}main{width:min(560px,calc(100vw - 32px))}h1{margin:0 0 8px;font-size:24px}p{margin:0;color:#4b5563}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
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

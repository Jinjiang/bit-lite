import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProxyServer,
  proxyHttpRequest,
  proxyWebSocket,
  sendText,
} from "./index.js";

const servers: ProxyServer[] = [];
const nodeServers: Array<http.Server | net.Server> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(nodeServers.splice(0).map(closeNodeServer));
});

describe("ProxyServer", () => {
  it("uses ordered routes, rejects duplicate IDs, and returns a controlled 404", async () => {
    const server = trackProxy(new ProxyServer());
    server.addRoute({
      id: "first",
      matches: (url) => url.pathname === "/ordered",
      handleHttp(_request, response) {
        sendText(response, 200, "first");
      },
    });
    server.addRoute({
      id: "second",
      matches: (url) => url.pathname === "/ordered",
      handleHttp(_request, response) {
        sendText(response, 200, "second");
      },
    });
    expect(() => server.addRoute({
      id: "first",
      matches: () => false,
      handleHttp() {},
    })).toThrow('Proxy route "first" is already registered');

    await server.start("127.0.0.1", 44_000);
    expect(await fetch(`${server.origin}/ordered`).then((response) => response.text())).toBe("first");
    const missing = await fetch(`${server.origin}/missing`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Not found");
  });

  it("selects the next available port and closes active sockets idempotently", async () => {
    const occupied = trackNode(net.createServer());
    const occupiedPort = await listen(occupied, 44_100);
    const server = trackProxy(new ProxyServer());
    const endpoint = await server.start("127.0.0.1", occupiedPort);
    expect(endpoint.port).toBeGreaterThan(occupiedPort);

    const socket = net.connect(endpoint.port, endpoint.host);
    await onceConnected(socket);
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    await server.close();
    await closed;
    await server.close();
    await expect(fetch(`${endpoint.origin}/`)).rejects.toThrow();
  });

  it("forwards HTTP requests without service-specific dependencies", async () => {
    let receivedUrl = "";
    let receivedHost = "";
    const upstream = trackNode(http.createServer((request, response) => {
      receivedUrl = request.url ?? "";
      receivedHost = request.headers.host ?? "";
      response.statusCode = 201;
      response.end("forwarded");
    }));
    const upstreamPort = await listen(upstream);
    const server = trackProxy(new ProxyServer());
    server.addRoute({
      id: "upstream",
      matches: (url) => url.pathname.startsWith("/upstream"),
      handleHttp(request, response) {
        return proxyHttpRequest(request, response, { origin: `http://127.0.0.1:${upstreamPort}` });
      },
    });
    await server.start("127.0.0.1", 44_200);

    const response = await fetch(`${server.origin}/upstream/file.js?version=2`);
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("forwarded");
    expect(receivedUrl).toBe("/upstream/file.js?version=2");
    expect(receivedHost).toBe(`127.0.0.1:${upstreamPort}`);
  });

  it("forwards WebSocket upgrades", async () => {
    let receivedUrl = "";
    const upstream = trackNode(http.createServer());
    upstream.on("upgrade", (request, socket) => {
      receivedUrl = request.url ?? "";
      socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nready");
    });
    const upstreamPort = await listen(upstream);
    const server = trackProxy(new ProxyServer());
    server.addRoute({
      id: "socket",
      matches: (url) => url.pathname === "/socket",
      handleHttp(_request, response) {
        sendText(response, 426, "Upgrade required");
      },
      handleUpgrade(request, socket, head) {
        proxyWebSocket(request, socket, head, { origin: `http://127.0.0.1:${upstreamPort}` });
      },
    });
    const endpoint = await server.start("127.0.0.1", 44_300);

    const response = await rawRequest(endpoint.port, [
      "GET /socket HTTP/1.1",
      `Host: ${endpoint.host}:${endpoint.port}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "",
      "",
    ].join("\r\n"));
    expect(response).toContain("101 Switching Protocols");
    expect(response).toContain("ready");
    expect(receivedUrl).toBe("/socket");
  });
});

function trackProxy(server: ProxyServer) {
  servers.push(server);
  return server;
}

function trackNode<Server extends http.Server | net.Server>(server: Server) {
  nodeServers.push(server);
  return server;
}

function listen(server: http.Server | net.Server, port = 0) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("Could not listen"));
      else resolve(address.port);
    });
  });
}

function closeNodeServer(server: http.Server | net.Server) {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function onceConnected(socket: net.Socket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
}

function rawRequest(port: number, request: string) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = net.connect(port, "127.0.0.1", () => socket.write(request));
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
}

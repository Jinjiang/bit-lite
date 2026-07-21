import http from "node:http";
import net from "node:net";
import { ProxyServer } from "bit-lite-proxy";
import { describe, expect, it, vi } from "vitest";
import { createPreviewServiceRoutes, PreviewProxyServer, PreviewProxyState } from "./proxy.js";

describe("preview proxy", () => {
  it("publishes overview, docs, and named-demo hash routes and failed env state", async () => {
    const env = selectedEnv("react env");
    const proxy = new PreviewProxyServer({
      envs: [
        {
          env,
          taskId: "react env",
          vendor: "vite-preview",
          status: "starting",
          components: [{ id: "scope/button" }],
        },
      ],
    });
    await proxy.start("127.0.0.1", 43_000);

    const shell = await fetch(`${proxy.origin}/`).then((response) => response.text());
    expect(shell).toContain("isTerminalStatus");
    expect(shell).not.toContain("setInterval(loadManifest");

    proxy.updatePreparedComponents(env, "/env/react%20env/", [
      {
        component: { id: "scope/button" },
        docs: {
          title: "Button docs",
          filePath: "/workspace/button.docs.mdx",
          route: "#scope%2Fbutton?preview=docs",
        },
        compositions: [
          {
            id: "primary/MySecondDemo",
            exportName: "MySecondDemo",
            name: "My Second Demo",
            filePath: "/workspace/primary.demo.tsx",
            route: "#scope%2Fbutton?preview=compositions&name=primary%2FMySecondDemo",
          },
        ],
      },
    ]);

    const manifest = await fetch(`${proxy.origin}/__bit-lite/manifest.json`).then((response) => response.json());
    expect(manifest.envs[0].env).toEqual(env);
    expect(manifest.envs[0]).not.toHaveProperty("envName");
    expect(manifest).not.toHaveProperty("skipped");
    expect(manifest.envs[0].components[0]).toEqual({
      componentId: "scope/button",
      overviewRoute: "/env/react%20env/#scope%2Fbutton",
      docsRoute: "/env/react%20env/#scope%2Fbutton?preview=docs",
      compositions: [
        {
          id: "primary/MySecondDemo",
          exportName: "MySecondDemo",
          name: "My Second Demo",
          route: "/env/react%20env/#scope%2Fbutton?preview=compositions&name=primary%2FMySecondDemo",
        },
      ],
    });

    proxy.updatePreparationFailure(env, new Error("config could not be resolved"));
    const failed = await fetch(`${proxy.origin}/env/react%20env/`);
    expect(failed.status).toBe(503);
    expect(await failed.text()).toContain("config could not be resolved");
    expect(proxy.manifest().envs[0]).toMatchObject({ status: "failed", error: "config could not be resolved" });

    await proxy.close();
    await expect(fetch(`${proxy.origin}/`)).rejects.toThrow();
  });

  it("forwards env-scoped assets to the ready vendor and cleans up sockets", async () => {
    const env = selectedEnv("static");
    let receivedUrl = "";
    const upstream = http.createServer((request, response) => {
      receivedUrl = request.url ?? "";
      response.end("asset-ok");
    });
    const upstreamPort = await listen(upstream);
    const proxy = new PreviewProxyServer({
      envs: [
        {
          env,
          taskId: "static",
          vendor: "vite-preview",
          status: "starting",
          components: [],
        },
      ],
    });
    await proxy.start("127.0.0.1", 43_100);
    proxy.updateServer(
      env,
      { origin: `http://127.0.0.1:${upstreamPort}`, host: "127.0.0.1", port: upstreamPort, basePath: "/env/static/" },
      "vite-preview"
    );

    const response = await fetch(`${proxy.origin}/env/static/__bit-lite/preview.js?update=1`);
    expect(await response.text()).toBe("asset-ok");
    expect(receivedUrl).toBe("/env/static/__bit-lite/preview.js?update=1");

    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  });

  it("forwards WebSocket upgrades through an encoded env route", async () => {
    const env = selectedEnv("react env");
    let receivedUrl = "";
    const upstream = http.createServer();
    upstream.on("upgrade", (request, socket) => {
      receivedUrl = request.url ?? "";
      socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\npreview-ready");
    });
    const upstreamPort = await listen(upstream);
    const proxy = new PreviewProxyServer({
      envs: [
        {
          env,
          taskId: "react env",
          vendor: "vite-preview",
          status: "starting",
          components: [],
        },
      ],
    });
    const endpoint = await proxy.start("127.0.0.1", 43_200);
    proxy.updateServer(
      env,
      {
        origin: `http://127.0.0.1:${upstreamPort}`,
        host: "127.0.0.1",
        port: upstreamPort,
        basePath: "/env/react%20env/",
      },
      "vite-preview"
    );

    const response = await rawRequest(endpoint.port, [
      "GET /env/react%20env/__vite_hmr HTTP/1.1",
      `Host: ${endpoint.host}:${endpoint.port}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "",
      "",
    ].join("\r\n"));
    expect(response).toContain("101 Switching Protocols");
    expect(response).toContain("preview-ready");
    expect(receivedUrl).toBe("/env/react%20env/__vite_hmr");

    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  });

  it("awaits one cold activation for concurrent direct child requests and preserves each URL", async () => {
    const env = selectedEnv("lazy env");
    const receivedUrls: string[] = [];
    const upstream = http.createServer((request, response) => {
      receivedUrls.push(request.url ?? "");
      response.end("lazy-ready");
    });
    const upstreamPort = await listen(upstream);
    const state = new PreviewProxyState({
      envs: [{ env, taskId: "lazy", vendor: "vite-preview", status: "idle", components: [] }],
    });
    const activate = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      state.updateServer(
        env,
        {
          origin: `http://127.0.0.1:${upstreamPort}`,
          host: "127.0.0.1",
          port: upstreamPort,
          basePath: "/env/lazy%20env/",
        },
        "vite-preview"
      );
    });
    let activation: Promise<void> | undefined;
    const proxy = new ProxyServer().addRoutes(createPreviewServiceRoutes(state, {
      ensureStarted() {
        activation ??= activate();
        return activation;
      },
    }));
    const endpoint = await proxy.start("127.0.0.1", 43_300);

    const unknown = await fetch(`${endpoint.origin}/env/unknown/asset.js`);
    expect(unknown.status).toBe(404);
    expect(activate).not.toHaveBeenCalled();

    const [script, style] = await Promise.all([
      fetch(`${endpoint.origin}/env/lazy%20env/assets/app.js?cold=1`),
      fetch(`${endpoint.origin}/env/lazy%20env/assets/app.css?cold=2`),
    ]);
    expect(await script.text()).toBe("lazy-ready");
    expect(await style.text()).toBe("lazy-ready");
    expect(activate).toHaveBeenCalledOnce();
    expect(receivedUrls.sort()).toEqual([
      "/env/lazy%20env/assets/app.css?cold=2",
      "/env/lazy%20env/assets/app.js?cold=1",
    ]);

    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  });

  it("allows a WebSocket upgrade to be the first activation traffic", async () => {
    const env = selectedEnv("socket env");
    const upstream = http.createServer();
    upstream.on("upgrade", (request, socket) => {
      socket.end(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n" +
        `activated:${request.url}`
      );
    });
    const upstreamPort = await listen(upstream);
    const state = new PreviewProxyState({
      envs: [{ env, taskId: "socket", vendor: "vite-preview", status: "idle", components: [] }],
    });
    const activate = vi.fn(async () => {
      state.updateServer(
        env,
        {
          origin: `http://127.0.0.1:${upstreamPort}`,
          host: "127.0.0.1",
          port: upstreamPort,
          basePath: "/env/socket%20env/",
        },
        "vite-preview"
      );
    });
    const proxy = new ProxyServer().addRoutes(createPreviewServiceRoutes(state, { ensureStarted: activate }));
    const endpoint = await proxy.start("127.0.0.1", 43_400);

    const response = await rawRequest(endpoint.port, [
      "GET /env/socket%20env/__vite_hmr HTTP/1.1",
      `Host: ${endpoint.host}:${endpoint.port}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "",
      "",
    ].join("\r\n"));
    expect(response).toContain("101 Switching Protocols");
    expect(response).toContain("activated:/env/socket%20env/__vite_hmr");
    expect(activate).toHaveBeenCalledOnce();

    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  });
});

function listen(server: http.Server) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("Could not listen"));
      else resolve(address.port);
    });
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

function selectedEnv(packageName: string) {
  return { packageName, requestedVersion: "workspace:*", installedVersion: "0.0.0" };
}

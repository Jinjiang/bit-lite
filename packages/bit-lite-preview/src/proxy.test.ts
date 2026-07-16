import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { PreviewProxyServer } from "./proxy.js";

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

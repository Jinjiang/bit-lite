import http from "node:http";
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

function selectedEnv(packageName: string) {
  return { packageName, requestedVersion: "workspace:*", installedVersion: "0.0.0" };
}

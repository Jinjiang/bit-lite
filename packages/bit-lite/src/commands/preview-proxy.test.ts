import http from "node:http";
import { describe, expect, it } from "vitest";
import { PreviewProxyServer } from "./preview-proxy.js";

describe("preview proxy", () => {
  it("publishes overview, docs, and named-demo hash routes and failed env state", async () => {
    const proxy = new PreviewProxyServer({
      envs: [
        {
          envName: "react env",
          taskId: "react env",
          vendor: "vite-preview",
          status: "starting",
          components: [{ id: "scope/button" }],
        },
      ],
      skipped: [],
    });
    await proxy.start("127.0.0.1", 43_000);

    proxy.updatePreparedComponents("react env", "/env/react%20env/", [
      {
        component: { id: "scope/button" },
        docs: {
          title: "Button docs",
          filePath: "/workspace/button.docs.mdx",
          route: "#scope%2Fbutton?preview=docs",
        },
        compositions: [
          {
            id: "primary state",
            title: "Primary",
            filePath: "/workspace/primary.demo.tsx",
            route: "#scope%2Fbutton?preview=compositions&name=primary%20state",
          },
        ],
      },
    ]);

    const manifest = await fetch(`${proxy.origin}/__bit-lite/manifest.json`).then((response) => response.json());
    expect(manifest.envs[0].components[0]).toEqual({
      componentId: "scope/button",
      overviewRoute: "/env/react%20env/#scope%2Fbutton",
      docsRoute: "/env/react%20env/#scope%2Fbutton?preview=docs",
      compositions: [
        {
          id: "primary state",
          title: "Primary",
          route: "/env/react%20env/#scope%2Fbutton?preview=compositions&name=primary%20state",
        },
      ],
    });

    proxy.updatePreparationFailure("react env", new Error("config could not be resolved"));
    const failed = await fetch(`${proxy.origin}/env/react%20env/`);
    expect(failed.status).toBe(503);
    expect(await failed.text()).toContain("config could not be resolved");
    expect(proxy.manifest().envs[0]).toMatchObject({ status: "failed", error: "config could not be resolved" });

    await proxy.close();
    await expect(fetch(`${proxy.origin}/`)).rejects.toThrow();
  });

  it("forwards env-scoped assets to the ready vendor and cleans up sockets", async () => {
    let receivedUrl = "";
    const upstream = http.createServer((request, response) => {
      receivedUrl = request.url ?? "";
      response.end("asset-ok");
    });
    const upstreamPort = await listen(upstream);
    const proxy = new PreviewProxyServer({
      envs: [
        {
          envName: "static",
          taskId: "static",
          vendor: "vite-preview",
          status: "starting",
          components: [],
        },
      ],
      skipped: [],
    });
    await proxy.start("127.0.0.1", 43_100);
    proxy.updateServer(
      "static",
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

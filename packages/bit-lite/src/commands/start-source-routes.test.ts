import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProxyServer } from "bit-lite-proxy";
import { afterEach, describe, expect, it } from "vitest";
import {
  createStartSourceCatalog,
  createStartSourceRoute,
  createStartSourceRoutes,
} from "./start-source.js";
import type { WorkspaceComponent } from "bit-lite-context";

const servers: ProxyServer[] = [];
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("start source routes", () => {
  it("encodes component IDs as one source-page query value", () => {
    expect(createStartSourceRoute("scope/a b?#")).toBe("/source?component=scope%2Fa%20b%3F%23");
  });

  it("serves a live, uncached source page, index, and text snapshot", async () => {
    const fixture = await createFixture();
    const server = await startSourceServer([fixture.component]);
    const componentQuery = new URLSearchParams({ component: fixture.component.id });

    const page = await fetch(`${server.origin}/source?${componentQuery}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Component source");

    const indexResponse = await fetch(`${server.origin}/__bit-lite/source-files.json?${componentQuery}`);
    expect(indexResponse.status).toBe(200);
    expect(indexResponse.headers.get("cache-control")).toBe("no-store");
    const indexText = await indexResponse.text();
    expect(indexText).not.toContain(fixture.rootDir);
    expect(JSON.parse(indexText)).toEqual({
      componentId: "scope/a b",
      mainFile: "index.ts",
      files: [
        { path: ".comp.json", size: 3 },
        { path: "index.ts", size: 26 },
      ],
    });

    const fileUrl = new URL("/__bit-lite/source-file.json", server.origin);
    fileUrl.searchParams.set("component", fixture.component.id);
    fileUrl.searchParams.set("path", "index.ts");
    await expect(fetch(fileUrl).then((response) => response.json())).resolves.toMatchObject({
      componentId: "scope/a b",
      path: "index.ts",
      kind: "text",
      content: "export const answer = 41;\n",
    });

    await writeFile(path.join(fixture.rootDir, "index.ts"), "export const answer = 42;\n", "utf8");
    await expect(fetch(fileUrl).then((response) => response.json())).resolves.toMatchObject({
      kind: "text",
      content: "export const answer = 42;\n",
    });
  });

  it("rejects incomplete, unselected, escaping, and non-GET requests with stable responses", async () => {
    const fixture = await createFixture();
    const server = await startSourceServer([fixture.component]);

    const missingComponent = await fetch(`${server.origin}/__bit-lite/source-files.json`);
    expect(missingComponent.status).toBe(400);
    await expect(missingComponent.json()).resolves.toEqual({ error: "A component query parameter is required" });

    const unknown = await fetch(`${server.origin}/__bit-lite/source-files.json?component=scope%2Funselected`);
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toEqual({ error: "Selected component was not found" });

    const missingPath = await fetch(`${server.origin}/__bit-lite/source-file.json?component=scope%2Fa%20b`);
    expect(missingPath.status).toBe(400);
    await expect(missingPath.json()).resolves.toEqual({ error: "A path query parameter is required" });

    const traversal = new URL("/__bit-lite/source-file.json", server.origin);
    traversal.searchParams.set("component", fixture.component.id);
    traversal.searchParams.set("path", "../outside.ts");
    const traversalResponse = await fetch(traversal);
    expect(traversalResponse.status).toBe(404);
    await expect(traversalResponse.json()).resolves.toEqual({ error: "Source file was not found" });

    for (const route of [
      "/source?component=scope%2Fa%20b",
      "/__bit-lite/source-files.json?component=scope%2Fa%20b",
      "/__bit-lite/source-file.json?component=scope%2Fa%20b&path=index.ts",
    ]) {
      const response = await fetch(`${server.origin}${route}`, { method: "POST" });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
    }
  });
});

async function createFixture() {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-start-source-routes-"));
  tempRoots.push(fixtureRoot);
  const rootDir = path.join(fixtureRoot, "component");
  await mkdir(rootDir, { recursive: true });
  await writeFile(path.join(rootDir, ".comp.json"), "{}\n", "utf8");
  await writeFile(path.join(rootDir, "index.ts"), "export const answer = 41;\n", "utf8");
  return {
    rootDir,
    component: {
      id: "scope/a b",
      rootDir,
      mainFileRelative: "index.ts",
    } as WorkspaceComponent,
  };
}

async function startSourceServer(components: WorkspaceComponent[]) {
  const server = new ProxyServer();
  servers.push(server);
  server.addRoutes(createStartSourceRoutes(createStartSourceCatalog(components)));
  await server.start("127.0.0.1", 47_100);
  return server;
}

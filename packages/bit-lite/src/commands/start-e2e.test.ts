import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "bit-lite-context";
import { ProxyServer } from "bit-lite-proxy";
import { stopVendorTasks } from "bit-lite-vendors";
import { describe, expect, it, vi } from "vitest";
import { prepareResolvedCommandSelection } from "../utils/command-selection.js";
import { createPreviewCommandContribution } from "./preview.js";
import { createStartRoutes } from "./start.js";
import { createTestWatchContribution } from "./test.js";

describe("start end-to-end", () => {
  it("serves inherited preview and live test state through one origin with a single Vite HMR base path", async () => {
    const workspaceRoot = await createInheritedStartWorkspace();
    const parsed = parseArgs(["start", "--workspace", workspaceRoot]);
    const selection = await prepareResolvedCommandSelection(parsed);
    const proxy = new ProxyServer();
    const endpoint = await proxy.start("127.0.0.1", 48_000);
    let preview: Awaited<ReturnType<typeof createPreviewCommandContribution>> | undefined;
    let test: Awaited<ReturnType<typeof createTestWatchContribution>> | undefined;
    let socket: WebSocket | undefined;

    try {
      expect(selection.groups).toHaveLength(1);
      expect(selection.groups[0]?.env.env).toEqual({
        packageName: "@fixture/env-child",
        requestedVersion: "1.0.0",
        installedVersion: "1.0.0",
      });
      expect(selection.groups[0]?.env.services.preview?.source.identity.packageName).toBe("@fixture/env-parent");
      expect(selection.groups[0]?.env.services.test?.source.identity.packageName).toBe("@fixture/env-parent");

      preview = await createPreviewCommandContribution(selection, { proxy: endpoint, host: endpoint.host });
      test = await createTestWatchContribution(selection);
      proxy.addRoutes(createStartRoutes(endpoint, preview, test));
      proxy.addRoutes(preview.routes);
      proxy.addRoutes(test.routes);

      expect(preview.tasks).toHaveLength(1);
      expect(test.tasks).toHaveLength(1);
      expect(preview.tasks[0]?.context.service.source.identity.packageName).toBe("@fixture/env-parent");
      expect(test.tasks[0]?.context.service.source.identity.packageName).toBe("@fixture/env-parent");
      await vi.waitFor(() => expect(preview?.manifest().envs[0]?.status).toBe("ready"), { timeout: 20_000 });
      await vi.waitFor(() => expect(test?.resultStore.entries().length).toBeGreaterThan(0), { timeout: 20_000 });

      const rootResponse = await fetch(`${endpoint.origin}/`);
      expect(rootResponse.status).toBe(200);
      expect(await rootResponse.text()).toContain("bit-lite start");
      const manifest = await fetch(`${endpoint.origin}/__bit-lite/manifest.json`).then((response) => response.json());
      expect(manifest.components[0]).toMatchObject({
        componentId: "components/sample",
        env: {
          packageName: "@fixture/env-child",
          requestedVersion: "1.0.0",
          installedVersion: "1.0.0",
        },
        test: { vendor: "vitest" },
      });
      expect(JSON.stringify(manifest)).not.toContain("envName");

      const basePath = "/env/%40fixture%2Fenv-child/";
      const previewResponse = await fetch(`${endpoint.origin}${basePath}`);
      const previewHtml = await previewResponse.text();
      expect(previewResponse.status).toBe(200);
      expect(previewHtml).toContain('id="preview-root"');
      const entryResponse = await fetch(`${endpoint.origin}${basePath}__bit-lite/preview.js`);
      expect(entryResponse.status).toBe(200);
      expect(await entryResponse.text()).toContain("sample.demo.ts");
      const demoResponse = await fetch(`${endpoint.origin}${basePath}components/sample/sample.demo.ts`);
      expect(demoResponse.status).toBe(200);
      expect(await demoResponse.text()).toContain("initial preview");

      const hmrClient = await fetch(`${endpoint.origin}${basePath}@vite/client`).then((response) => response.text());
      expect(hmrClient).toContain(basePath);
      expect(hmrClient).not.toContain(`${basePath}${basePath.slice(1)}`);
      const token = readHmrToken(hmrClient);
      socket = await connectHmr(endpoint.origin, basePath, token);

      const demoFile = path.join(workspaceRoot, "components", "sample", "sample.demo.ts");
      const nextUpdate = waitForHmrMessage(socket, (message) => message.type === "update" || message.type === "full-reload");
      await writeFile(demoFile, 'export function Primary(root) { root.textContent = "updated preview"; }\n', "utf8");
      expect((await nextUpdate).type).toMatch(/^(update|full-reload)$/);

      const testTask = test.tasks[0]!;
      const initialRun = test.resultStore.entries().at(-1)?.json.run ?? 0;
      const initialOutputBytes = testTask.rawOutput.byteLength;
      await writeTestFile(workspaceRoot, "updated test output");
      await vi.waitFor(
        () => expect(test?.resultStore.entries().at(-1)?.json.run).toBeGreaterThan(initialRun),
        { timeout: 20_000 }
      );
      await vi.waitFor(() => expect(testTask.rawOutput.byteLength).toBeGreaterThan(initialOutputBytes), { timeout: 20_000 });

      const resultUrl = new URL("/__bit-lite/test-results.json", endpoint.origin);
      resultUrl.searchParams.set("component", "components/sample");
      const result = await fetch(resultUrl).then((response) => response.json());
      expect(result).toMatchObject({
        componentId: "components/sample",
        env: { packageName: "@fixture/env-child" },
        task: { vendor: "vitest" },
        terminal: { scope: "env" },
      });
      expect(result.result.run).toBeGreaterThan(initialRun);
      expect(result.notices.join(" ")).toContain("may include other components");
    } finally {
      socket?.close();
      await stopVendorTasks([...(preview?.tasks ?? []), ...(test?.tasks ?? [])]);
      await test?.dispose();
      await preview?.dispose();
      await proxy.close();
      await removeWorkspace(workspaceRoot);
    }
  }, 60_000);
});

async function createInheritedStartWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-start-e2e-"));
  const componentRoot = path.join(workspaceRoot, "components", "sample");
  await mkdir(componentRoot, { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "bit-lite.json"),
    JSON.stringify({
      components: [{
        id: "components/sample",
        path: "components/sample",
        packageName: "@fixture/sample",
        env: { packageName: "@fixture/env-child", version: "1.0.0" },
      }],
    }, null, 2),
    "utf8"
  );
  await writeFile(path.join(workspaceRoot, "package.json"), '{"type":"module"}\n', "utf8");
  await writeFile(path.join(componentRoot, ".comp.json"), "{}\n", "utf8");
  await writeFile(path.join(componentRoot, "index.ts"), "export const add = (a: number, b: number) => a + b;\n", "utf8");
  await writeFile(path.join(componentRoot, "sample.docs.mdx"), "# Start E2E docs\n", "utf8");
  await writeFile(
    path.join(componentRoot, "sample.demo.ts"),
    'export function Primary(root) { root.textContent = "initial preview"; }\n',
    "utf8"
  );
  await writeTestFile(workspaceRoot, "initial test output");

  const envRoot = path.join(workspaceRoot, ".fixture-envs");
  const parentRoot = path.join(envRoot, "parent");
  const childRoot = path.join(envRoot, "child");
  await mkdir(parentRoot, { recursive: true });
  await mkdir(childRoot, { recursive: true });
  await writeFile(path.join(parentRoot, "package.json"), JSON.stringify({
    name: "@fixture/env-parent",
    version: "1.0.0",
    type: "module",
    exports: { ".": "./index.json" },
  }), "utf8");
  await writeFile(path.join(parentRoot, "index.json"), JSON.stringify({
    name: "@fixture/env-parent",
    services: {
      preview: {
        vendor: "demo-vendors/previewers/vite",
        config: {
          configFile: "demo-config/previewers/vite-static",
          mounter: "demo-config/previewers/static-mounter",
          docsTemplate: "demo-config/previewers/docs-template",
        },
      },
      test: {
        vendor: "demo-vendors/testers/vitest",
        config: { configFile: "demo-config/testers/vitest/node" },
      },
    },
  }), "utf8");
  await writeFile(path.join(childRoot, "package.json"), JSON.stringify({
    name: "@fixture/env-child",
    version: "1.0.0",
    type: "module",
    exports: { ".": "./index.json" },
    dependencies: { "@fixture/env-parent": "1.0.0" },
  }), "utf8");
  await writeFile(path.join(childRoot, "index.json"), JSON.stringify({
    name: "@fixture/env-child",
    extends: "@fixture/env-parent",
    services: {},
  }), "utf8");
  await linkPackage(path.join(childRoot, "node_modules", "@fixture", "env-parent"), parentRoot);

  const selectedEnvTarget = path.join(
    workspaceRoot,
    ".bit-lite", "deps", "components", "@fixture", "sample", "node_modules", "@fixture", "env-child"
  );
  await linkPackage(selectedEnvTarget, childRoot);
  await linkPackage(path.join(workspaceRoot, "node_modules", "demo-config"), path.join(repoRoot(), "packages", "demo-config"));
  await linkPackage(path.join(workspaceRoot, "node_modules", "demo-vendors"), path.join(repoRoot(), "packages", "demo-vendors"));
  return workspaceRoot;
}

async function writeTestFile(workspaceRoot: string, marker: string) {
  await writeFile(
    path.join(workspaceRoot, "components", "sample", "index.test.ts"),
    [
      'import assert from "node:assert/strict";',
      'import { add } from "./index.js";',
      `console.log(${JSON.stringify(marker)});`,
      'describe("add", () => {',
      '  it("adds", () => assert.equal(add(2, 3), 5));',
      "});",
      "",
    ].join("\n"),
    "utf8"
  );
}

async function linkPackage(target: string, source: string) {
  await mkdir(path.dirname(target), { recursive: true });
  await symlink(path.relative(path.dirname(target), source), target, "dir");
}

function repoRoot() {
  const cwd = process.cwd();
  return path.basename(cwd) === "bit-lite" && path.basename(path.dirname(cwd)) === "packages"
    ? path.resolve(cwd, "../..")
    : cwd;
}

function readHmrToken(source: string) {
  const match = /const wsToken = "([^"]+)"/.exec(source);
  if (!match?.[1]) throw new Error("Vite client did not expose a transformed HMR token");
  return match[1];
}

function connectHmr(origin: string, basePath: string, token: string) {
  const url = new URL(basePath, origin);
  url.protocol = "ws:";
  url.searchParams.set("token", token);
  const socket = new WebSocket(url, "vite-hmr");
  return new Promise<WebSocket>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out connecting to ${url}`)), 10_000);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { type?: string };
      if (message.type !== "connected") return;
      clearTimeout(timeout);
      resolve(socket);
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`Failed connecting to ${url}`));
    }, { once: true });
  });
}

function waitForHmrMessage(socket: WebSocket, accept: (message: { type?: string }) => boolean) {
  return new Promise<{ type?: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", handleMessage);
      reject(new Error("Timed out waiting for a Vite HMR message"));
    }, 15_000);
    const handleMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as { type?: string };
      if (!accept(message)) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", handleMessage);
      resolve(message);
    };
    socket.addEventListener("message", handleMessage);
  });
}

async function removeWorkspace(workspaceRoot: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await rm(workspaceRoot, { recursive: true, force: true });
    try {
      await access(workspaceRoot);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`start E2E workspace remained after cleanup: ${workspaceRoot}`);
}

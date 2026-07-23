import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "bit-lite-context";
import { ProxyServer } from "bit-lite-proxy";
import { describe, expect, it, vi } from "vitest";
import { prepareResolvedCommandSelection } from "../utils/command-selection.js";
import { createPreviewCommandContribution } from "./preview.js";
import {
  createCompileWatchContribution,
  selectCompileRootIds,
} from "./compile.js";
import { createStartSourceCatalog } from "./start-source.js";
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
    let compile: Awaited<ReturnType<typeof createCompileWatchContribution>> | undefined;
    let socket: WebSocket | undefined;

    try {
      expect(selection.groups).toHaveLength(2);
      const previewGroup = selection.groups.find(
        (group) => group.env.env.packageName === "@fixture/env-child"
      );
      expect(previewGroup?.env.env).toEqual({
        packageName: "@fixture/env-child",
        requestedVersion: "1.0.0",
        installedVersion: "1.0.0",
      });
      expect(previewGroup?.env.services.preview?.source.identity.packageName).toBe("@fixture/env-parent");
      expect(previewGroup?.env.services.test?.source.identity.packageName).toBe("@fixture/env-parent");
      expect(previewGroup?.env.services.compile?.source.identity.packageName).toBe("@fixture/env-parent");

      compile = await createCompileWatchContribution(
        selection.context.workspace,
        selectCompileRootIds(selection),
        selection.parsed.args
      );
      await compile.ready();
      await expect(access(path.join(workspaceRoot, "node_modules/@fixture/dependency/dist/index.js")))
        .resolves.toBeUndefined();
      await expect(access(path.join(workspaceRoot, "node_modules/@fixture/sample/dist/index.js")))
        .resolves.toBeUndefined();
      preview = await createPreviewCommandContribution(selection, { proxy: endpoint, host: endpoint.host });
      test = await createTestWatchContribution(selection);
      proxy.addRoutes(createStartRoutes(
        endpoint,
        preview,
        test,
        createStartSourceCatalog(selection.components),
        { selection, compile }
      ));
      proxy.addRoutes(preview.routes);
      proxy.addRoutes(test.routes);

      expect(preview.tasks).toHaveLength(1);
      expect(test.tasks).toHaveLength(1);
      expect(compile.tasks).toHaveLength(2);
      expect(compile.tasks.every((task) => task.context.args.options.watch === true)).toBe(true);
      expect(compile.bindings.map(({ component }) => component.id)).toEqual([
        "components/dependency",
        "components/sample",
      ]);
      expect(preview.tasks[0]?.context.service.source.identity.packageName).toBe("@fixture/env-parent");
      expect(test.tasks[0]?.context.service.source.identity.packageName).toBe("@fixture/env-parent");
      await vi.waitFor(() => expect(preview?.manifest().envs[0]?.status).toBe("ready"), { timeout: 20_000 });
      await vi.waitFor(() => expect(test?.resultStore.entries().length).toBeGreaterThan(0), { timeout: 20_000 });

      const rootResponse = await fetch(`${endpoint.origin}/`);
      expect(rootResponse.status).toBe(200);
      const rootHtml = await rootResponse.text();
      expect(rootHtml).toContain("bit-lite start");
      expect(rootHtml).toContain('link("source", component.source.route)');
      const manifest = await fetch(`${endpoint.origin}/__bit-lite/manifest.json`).then((response) => response.json());
      const sampleManifest = manifest.components.find(
        (component: { componentId: string }) => component.componentId === "components/sample"
      );
      expect(sampleManifest).toMatchObject({
        componentId: "components/sample",
        env: {
          packageName: "@fixture/env-child",
          requestedVersion: "1.0.0",
          installedVersion: "1.0.0",
        },
        source: { route: "/source?component=components%2Fsample" },
        test: { vendor: "vitest" },
        compile: { vendor: "typescript-compiler" },
      });
      expect(manifest.compiles.map(
        (item: { componentId: string }) => item.componentId
      )).toEqual(["components/dependency", "components/sample"]);
      expect(JSON.stringify(manifest)).not.toContain("envName");

      const sourcePage = await fetch(new URL(sampleManifest.source.route, endpoint.origin));
      expect(sourcePage.status).toBe(200);
      expect(await sourcePage.text()).toContain("Component source");
      const sourceIndexUrl = new URL("/__bit-lite/source-files.json", endpoint.origin);
      sourceIndexUrl.searchParams.set("component", "components/sample");
      const sourceIndex = await fetch(sourceIndexUrl).then((response) => response.json());
      expect(sourceIndex).toMatchObject({
        componentId: "components/sample",
        mainFile: "index.ts",
      });
      expect(sourceIndex.files.map((file: { path: string }) => file.path)).toEqual(expect.arrayContaining([
        ".comp.json",
        "index.ts",
        "sample.demo.ts",
        "sample.docs.mdx",
      ]));
      const sourceFileUrl = new URL("/__bit-lite/source-file.json", endpoint.origin);
      sourceFileUrl.searchParams.set("component", "components/sample");
      sourceFileUrl.searchParams.set("path", "index.ts");
      const initialSource = await fetch(sourceFileUrl).then((response) => response.json());
      expect(initialSource).toMatchObject({
        path: "index.ts",
        kind: "text",
        content: [
          'import { increment } from "@fixture/dependency";',
          "export const add = (a: number, b: number) => increment(a + b - 1);",
          "",
        ].join("\n"),
      });
      await writeFile(
        path.join(workspaceRoot, "components", "sample", "index.ts"),
        [
          'import { increment } from "@fixture/dependency";',
          "export const add = (a: number, b: number) => increment(a + b - 1); // source browser refresh",
          "",
        ].join("\n"),
        "utf8"
      );
      const updatedSource = await fetch(sourceFileUrl).then((response) => response.json());
      expect(updatedSource).toMatchObject({ kind: "text" });
      expect(updatedSource.content).toContain("source browser refresh");

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
      await test?.dispose();
      await preview?.dispose();
      await compile?.dispose();
      await proxy.close();
      await removeWorkspace(workspaceRoot);
    }
  }, 60_000);

  it("keeps start --lazy preview idle while test watch is already running", async () => {
    const workspaceRoot = await createInheritedStartWorkspace();
    const parsed = parseArgs(["start", "--lazy", "--workspace", workspaceRoot]);
    const selection = await prepareResolvedCommandSelection(parsed);
    const proxy = new ProxyServer();
    const endpoint = await proxy.start("127.0.0.1", 48_100);
    let preview: Awaited<ReturnType<typeof createPreviewCommandContribution>> | undefined;
    let test: Awaited<ReturnType<typeof createTestWatchContribution>> | undefined;
    let compile: Awaited<ReturnType<typeof createCompileWatchContribution>> | undefined;
    let socket: WebSocket | undefined;

    try {
      compile = await createCompileWatchContribution(
        selection.context.workspace,
        selectCompileRootIds(selection),
        selection.parsed.args
      );
      await compile.ready();
      preview = await createPreviewCommandContribution(selection, {
        proxy: endpoint,
        host: endpoint.host,
        activationMode: "lazy",
      });
      test = await createTestWatchContribution(selection);
      proxy.addRoutes(createStartRoutes(
        endpoint,
        preview,
        test,
        createStartSourceCatalog(selection.components),
        { selection, compile }
      ));
      proxy.addRoutes(preview.routes);
      proxy.addRoutes(test.routes);
      const previewTask = preview.tasks[0]!;
      const activate = vi.spyOn(previewTask, "activate");

      expect(previewTask.status).toBe("idle");
      expect(previewTask.canAttach).toBe(false);
      expect(compile.tasks[0]?.status).not.toBe("idle");
      await vi.waitFor(() => expect(test?.resultStore.entries().length).toBeGreaterThan(0), { timeout: 20_000 });
      expect(activate).not.toHaveBeenCalled();

      expect((await fetch(`${endpoint.origin}/`)).status).toBe(200);
      const before = await fetch(`${endpoint.origin}/__bit-lite/manifest.json`).then((response) => response.json());
      expect(before.preview.envs[0].status).toBe("idle");
      expect(before.tests[0].status).not.toBe("idle");
      expect(before.compiles[0].status).not.toBe("idle");
      expect(activate).not.toHaveBeenCalled();

      const basePath = "/env/%40fixture%2Fenv-child/";
      const coldAsset = await fetch(`${endpoint.origin}${basePath}__bit-lite/preview.js`);
      expect(coldAsset.status).toBe(200);
      expect(await coldAsset.text()).toContain("sample.demo.ts");
      expect(activate).toHaveBeenCalledOnce();
      expect(preview.manifest().envs[0]).toMatchObject({
        status: "ready",
        server: { port: expect.any(Number) },
      });

      const hmrClient = await fetch(`${endpoint.origin}${basePath}@vite/client`).then((response) => response.text());
      expect(hmrClient).toContain(basePath);
      socket = await connectHmr(endpoint.origin, basePath, readHmrToken(hmrClient));
      expect(activate).toHaveBeenCalledOnce();
    } finally {
      socket?.close();
      await test?.dispose();
      await preview?.dispose();
      await compile?.dispose();
      await proxy.close();
      await removeWorkspace(workspaceRoot);
    }
  }, 60_000);

  it("keeps preview and test available when the selected component has no compile service", async () => {
    const workspaceRoot = await createInheritedStartWorkspace();
    const parsed = parseArgs(["start", "--workspace", workspaceRoot, "--filter", "components/sample"]);
    const resolved = await prepareResolvedCommandSelection(parsed);
    const selection = {
      ...resolved,
      groups: resolved.groups.map((group) => ({
        ...group,
        env: {
          ...group.env,
          services: {
            preview: group.env.services.preview,
            test: group.env.services.test,
          },
        },
      })),
    };
    const proxy = new ProxyServer();
    const endpoint = await proxy.start("127.0.0.1", 48_200);
    const compile = await createCompileWatchContribution(
      selection.context.workspace,
      selectCompileRootIds(selection),
      selection.parsed.args
    );
    let preview: Awaited<ReturnType<typeof createPreviewCommandContribution>> | undefined;
    let test: Awaited<ReturnType<typeof createTestWatchContribution>> | undefined;

    try {
      await compile.ready();
      expect(compile.tasks).toHaveLength(0);
      preview = await createPreviewCommandContribution(selection, {
        proxy: endpoint,
        host: endpoint.host,
      });
      test = await createTestWatchContribution(selection);
      proxy.addRoutes(createStartRoutes(
        endpoint,
        preview,
        test,
        createStartSourceCatalog(selection.components),
        { selection, compile }
      ));
      proxy.addRoutes(preview.routes);
      proxy.addRoutes(test.routes);

      await vi.waitFor(() => expect(preview?.manifest().envs[0]?.status).toBe("ready"), { timeout: 20_000 });
      await vi.waitFor(() => expect(test?.resultStore.entries().length).toBeGreaterThan(0), { timeout: 20_000 });
      const manifest = await fetch(`${endpoint.origin}/__bit-lite/manifest.json`).then((response) => response.json());
      expect(manifest.compiles).toEqual([]);
      expect(manifest.components[0]).toMatchObject({
        componentId: "components/sample",
        preview: expect.any(Object),
        test: expect.any(Object),
      });
      expect(manifest.components[0]).not.toHaveProperty("compile");
    } finally {
      await test?.dispose();
      await preview?.dispose();
      await compile.dispose();
      await proxy.close();
      await removeWorkspace(workspaceRoot);
    }
  }, 60_000);
});

async function createInheritedStartWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-start-e2e-"));
  const componentRoot = path.join(workspaceRoot, "components", "sample");
  const dependencyRoot = path.join(workspaceRoot, "components", "dependency");
  await mkdir(componentRoot, { recursive: true });
  await mkdir(dependencyRoot, { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "bit-lite.json"),
    JSON.stringify({
      components: [
        {
          id: "components/sample",
          path: "components/sample",
          packageName: "@fixture/sample",
          env: { packageName: "@fixture/env-child", version: "1.0.0" },
        },
        {
          id: "components/dependency",
          path: "components/dependency",
          packageName: "@fixture/dependency",
          env: { packageName: "@fixture/env-dependency", version: "1.0.0" },
        },
      ],
    }, null, 2),
    "utf8"
  );
  await writeFile(path.join(workspaceRoot, "package.json"), '{"type":"module"}\n', "utf8");
  await writeFile(
    path.join(componentRoot, ".comp.json"),
    JSON.stringify({ dependencies: { "@fixture/dependency": "workspace:*" } }),
    "utf8"
  );
  await writeFile(
    path.join(componentRoot, "index.ts"),
    [
      'import { increment } from "@fixture/dependency";',
      "export const add = (a: number, b: number) => increment(a + b - 1);",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(path.join(dependencyRoot, ".comp.json"), "{}\n", "utf8");
  await writeFile(
    path.join(dependencyRoot, "index.ts"),
    "export const increment = (value: number) => value + 1;\n",
    "utf8"
  );
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
  const dependencyEnvRoot = path.join(envRoot, "dependency");
  await mkdir(parentRoot, { recursive: true });
  await mkdir(childRoot, { recursive: true });
  await mkdir(dependencyEnvRoot, { recursive: true });
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
      compile: {
        vendor: "demo-vendors/compilers/typescript",
        config: { target: "ES2022", jsx: "react-jsx" },
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
  await writeFile(path.join(dependencyEnvRoot, "package.json"), JSON.stringify({
    name: "@fixture/env-dependency",
    version: "1.0.0",
    type: "module",
    exports: { ".": "./index.json" },
  }), "utf8");
  await writeFile(path.join(dependencyEnvRoot, "index.json"), JSON.stringify({
    name: "@fixture/env-dependency",
    services: {
      compile: {
        vendor: "demo-vendors/compilers/typescript",
        config: { target: "ES2022", jsx: "react-jsx" },
      },
    },
  }), "utf8");
  await linkPackage(path.join(childRoot, "node_modules", "@fixture", "env-parent"), parentRoot);

  const selectedEnvTarget = path.join(
    workspaceRoot,
    ".bit-lite", "deps", "components", "@fixture", "sample", "node_modules", "@fixture", "env-child"
  );
  await linkPackage(selectedEnvTarget, childRoot);
  const dependencyEnvTarget = path.join(
    workspaceRoot,
    ".bit-lite", "deps", "components", "@fixture", "dependency",
    "node_modules", "@fixture", "env-dependency"
  );
  await linkPackage(dependencyEnvTarget, dependencyEnvRoot);
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

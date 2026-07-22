import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { getSelectedEnvKey, parseCliArguments } from "bit-lite-context";
import { ProxyServer } from "bit-lite-proxy";
import { stopVendorTasks } from "bit-lite-vendors";
import type { ParsedCliArgs, Workspace, WorkspaceContext, WorkspaceEnvGroup } from "bit-lite-context";
import { PreviewProxyServer } from "bit-lite-preview/node";
import { describe, expect, it, vi } from "vitest";
import {
  createPreviewCommandContribution,
  createPreviewPortHints,
  isPreviewServiceResult,
  preparePreviewTasks,
  readPreviewLazy,
} from "./preview.js";

describe("preview command preparation isolation", () => {
  it("starts valid env inputs while retaining failed env state and command-owned cleanup", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-preview-command-"));
    const validRoot = path.join(workspaceRoot, "components", "valid");
    const failedRoot = path.join(workspaceRoot, "components", "failed");
    await Promise.all([mkdir(validRoot, { recursive: true }), mkdir(failedRoot, { recursive: true })]);
    await Promise.all([
      writeFile(path.join(workspaceRoot, "package.json"), '{"type":"module"}\n', "utf8"),
      writeFile(path.join(validRoot, "valid.docs.md"), "# Valid docs\n", "utf8"),
      writeFile(path.join(failedRoot, "failed.docs.md"), "# Failed docs\n", "utf8"),
      writeFile(path.join(workspaceRoot, "vite.mjs"), "export default {};\n", "utf8"),
    ]);
    const groups: WorkspaceEnvGroup[] = [
      createGroup("valid", validRoot, "./vite.mjs", workspaceRoot, "parent"),
      createGroup("failed", failedRoot, "./missing.mjs", workspaceRoot),
    ];
    const workspace = createWorkspace(workspaceRoot, groups);
    const proxy = new PreviewProxyServer({
      envs: groups.map((group) => ({
        env: group.env.env,
        taskId: getSelectedEnvKey(group.env.env),
        vendor: "vite-preview",
        status: "starting",
        components: group.components,
      })),
    });

    const result = await preparePreviewTasks(
      groups,
      workspace,
      parseCliArguments([]),
      "http://127.0.0.1:4000",
      "127.0.0.1",
      proxy
    );
    const task = result.tasks[0];
    expect(result.tasks).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(task?.options.components).toBe(groups[0]?.components);
    expect(task?.options.runtime).toEqual(task?.prepared.runtime);
    expect(Object.keys(task?.options.runtime ?? {})).toEqual(["server", "prepared", "aliases"]);
    expect(task?.options.runtime?.server).toMatchObject({ preferredPort: 6000, fallbackStartPort: 6001 });
    expect(task?.options.runtime?.aliases).toEqual([
      { packageName: "@scope/valid", sourceDir: validRoot },
    ]);
    expect(task?.options.context.env.packageName).toBe("valid");
    expect(task?.options.context.service.source.identity.packageName).toBe("parent");
    expect(proxy.manifest().envs).toMatchObject([
      { env: selectedEnv("failed"), status: "failed", error: expect.stringContaining("could not resolve") },
      { env: selectedEnv("valid"), status: "starting", preferredPort: 6000, fallbackStartPort: 6001 },
    ]);

    const tempDir = task?.prepared.tempDir;
    await Promise.all(result.tasks.map((preparedTask) => preparedTask.prepared.cleanup()));
    await expect(access(tempDir ?? "")).rejects.toThrow();
  });

  it("assigns a deterministic preferred range and a shared fallback after it", () => {
    expect(createPreviewPortHints(3)).toEqual([
      { preferredPort: 6000, fallbackStartPort: 6003 },
      { preferredPort: 6001, fallbackStartPort: 6003 },
      { preferredPort: 6002, fallbackStartPort: 6003 },
    ]);
    expect(createPreviewPortHints(1, 65534)).toEqual([
      { preferredPort: 65534, fallbackStartPort: 65535 },
    ]);
    expect(() => createPreviewPortHints(2, 65534)).toThrow("leave no fallback port");
  });

  it("accepts only boolean lazy option values", () => {
    expect(readPreviewLazy(undefined)).toBe(false);
    expect(readPreviewLazy(false)).toBe(false);
    expect(readPreviewLazy(true)).toBe(true);
    expect(() => readPreviewLazy("true")).toThrow("--lazy requires a boolean value");
  });

  it("sorts prepared envs by canonical key before assigning preferred ports", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-preview-ports-"));
    const alphaRoot = path.join(workspaceRoot, "components", "alpha");
    const zetaRoot = path.join(workspaceRoot, "components", "zeta");
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(zetaRoot, { recursive: true })]);
    await Promise.all([
      writeFile(path.join(workspaceRoot, "package.json"), '{"type":"module"}\n', "utf8"),
      writeFile(path.join(workspaceRoot, "vite.mjs"), "export default {};\n", "utf8"),
      writeFile(path.join(alphaRoot, "alpha.docs.md"), "# Alpha\n", "utf8"),
      writeFile(path.join(zetaRoot, "zeta.docs.md"), "# Zeta\n", "utf8"),
    ]);
    const groups = [
      createGroup("zeta", zetaRoot, "./vite.mjs", workspaceRoot),
      createGroup("alpha", alphaRoot, "./vite.mjs", workspaceRoot),
    ];
    const workspace = createWorkspace(workspaceRoot, groups);
    const state = new PreviewProxyServer({
      envs: groups.map((group) => ({
        env: group.env.env,
        taskId: group.env.env.packageName,
        vendor: "fixture",
        status: "starting",
        components: group.components,
      })),
    });

    const result = await preparePreviewTasks(
      groups,
      workspace,
      parseCliArguments([]),
      "http://127.0.0.1:4000",
      "127.0.0.1",
      state
    );

    try {
      expect(result.tasks.map((task) => task.prepared.env.packageName)).toEqual(["alpha", "zeta"]);
      expect(result.tasks.map((task) => task.prepared.runtime.server)).toMatchObject([
        { preferredPort: 6000, fallbackStartPort: 6002 },
        { preferredPort: 6001, fallbackStartPort: 6002 },
      ]);
    } finally {
      await Promise.all(result.tasks.map((task) => task.prepared.cleanup()));
    }
  });

  it("accepts additional JSON data without reserving historical field names", () => {
    expect(isPreviewServiceResult({
      mode: "serve",
      port: 6000,
      vendorSpecific: true,
    })).toBe(true);
    expect(isPreviewServiceResult({
      envName: "valid",
      mode: "serve",
      port: 6000,
    })).toBe(true);
    expect(isPreviewServiceResult({ mode: "serve", port: 6000, env: selectedEnv("valid") })).toBe(true);
    expect(isPreviewServiceResult({ mode: "serve", port: 6000, server: { port: 6000 } })).toBe(true);
    expect(isPreviewServiceResult({ mode: "serve" })).toBe(false);
    expect(isPreviewServiceResult({ mode: "serve", port: 0 })).toBe(false);
    expect(isPreviewServiceResult({ mode: "serve", port: 1.5 })).toBe(false);
    expect(isPreviewServiceResult({ mode: "invalid" })).toBe(false);
  });

  it("returns caller-owned tasks and routes from a shared selection without process supervision", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-preview-contribution-"));
    const componentRoot = path.join(workspaceRoot, "components", "valid");
    await mkdir(componentRoot, { recursive: true });
    await Promise.all([
      writeFile(path.join(workspaceRoot, "package.json"), '{"type":"module"}\n', "utf8"),
      writeFile(path.join(componentRoot, "valid.docs.md"), "# Valid docs\n", "utf8"),
      writeFile(path.join(workspaceRoot, "vite.mjs"), "export default {};\n", "utf8"),
    ]);
    const vendor = previewVendorUrl();
    const group = createGroup("valid", componentRoot, "./vite.mjs", workspaceRoot, "parent", vendor);
    const workspace = createWorkspace(workspaceRoot, [group]);
    const context: WorkspaceContext = {
      workspace,
      components: group.components.map((component) => ({ component, env: group.env })),
    };
    const parsed: ParsedCliArgs = {
      command: "start",
      args: {
        raw: ["start", "--unknown", "value", "--", "fixture.ts"],
        options: { unknown: "value" },
        passthrough: ["fixture.ts"],
      },
      workspaceRoot,
      componentFilters: [],
      help: false,
    };
    const selection = { parsed, context, components: workspace.components, groups: [group] };
    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");
    const contribution = await createPreviewCommandContribution(selection, {
      proxy: { origin: "http://127.0.0.1:4000", host: "127.0.0.1", port: 4000 },
    });

    try {
      expect(contribution.tasks).toHaveLength(1);
      expect(contribution.routes).toHaveLength(1);
      expect(contribution.tasks[0]?.context.workspace).toBe(workspace);
      expect(contribution.tasks[0]?.context.env).toEqual(selectedEnv("valid"));
      expect(contribution.tasks[0]?.context.service.source.identity.packageName).toBe("parent");
      expect(contribution.tasks[0]?.context.args).toBe(parsed.args);
      expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
      await vi.waitFor(() => expect(contribution.manifest().envs[0]).toMatchObject({
        env: selectedEnv("valid"),
        vendor: "preview-fixture",
        status: "ready",
      }));
      expect(contribution.manifest().envs[0]).not.toHaveProperty("envName");
    } finally {
      await stopVendorTasks(contribution.tasks);
      await contribution.dispose();
      await contribution.dispose();
    }
  });

  it("keeps lazy tasks idle until any known child route is requested and coalesces cold traffic", async () => {
    const fixture = await createContributionSelection(previewHttpVendorUrl());
    const proxyServer = new ProxyServer();
    const endpoint = await proxyServer.start("127.0.0.1", 49_000);
    const contribution = await createPreviewCommandContribution(fixture.selection, {
      proxy: endpoint,
      activationMode: "lazy",
    });
    proxyServer.addRoutes(contribution.routes);
    const task = contribution.tasks[0]!;
    const activate = vi.spyOn(task, "activate");

    try {
      expect(task.status).toBe("idle");
      expect(task.canAttach).toBe(false);
      expect(contribution.manifest().envs[0]).toMatchObject({
        status: "idle",
        preferredPort: 6000,
        fallbackStartPort: 6001,
      });
      expect(contribution.manifest().envs[0]).not.toHaveProperty("server");

      expect((await fetch(`${endpoint.origin}/env/unknown/asset.js`)).status).toBe(404);
      expect(activate).not.toHaveBeenCalled();

      const [script, style] = await Promise.all([
        fetch(`${endpoint.origin}/env/lazy/assets/app.js?first=1`),
        fetch(`${endpoint.origin}/env/lazy/assets/app.css?first=2`),
      ]);
      expect(await script.text()).toBe("served:/env/lazy/assets/app.js?first=1");
      expect(await style.text()).toBe("served:/env/lazy/assets/app.css?first=2");
      expect(activate).toHaveBeenCalledOnce();
      expect(task.canAttach).toBe(true);
      expect(contribution.manifest().envs[0]).toMatchObject({
        status: "ready",
        server: { port: expect.any(Number), basePath: "/env/lazy/" },
      });

      expect(await fetch(`${endpoint.origin}/env/lazy/second.js`).then((response) => response.text()))
        .toBe("served:/env/lazy/second.js");
      expect(activate).toHaveBeenCalledOnce();
    } finally {
      await contribution.dispose();
      await proxyServer.close();
    }
    expect(contribution.manifest().envs[0]).toMatchObject({ status: "stopped" });
    expect(contribution.manifest().envs[0]).not.toHaveProperty("server");
  }, 20_000);

  it("caches a lazy activation failure instead of starting another worker", async () => {
    const fixture = await createContributionSelection(previewFailingVendorUrl());
    const proxyServer = new ProxyServer();
    const endpoint = await proxyServer.start("127.0.0.1", 49_100);
    const contribution = await createPreviewCommandContribution(fixture.selection, {
      proxy: endpoint,
      activationMode: "lazy",
    });
    proxyServer.addRoutes(contribution.routes);
    const task = contribution.tasks[0]!;
    const activate = vi.spyOn(task, "activate");

    try {
      const first = await fetch(`${endpoint.origin}/env/lazy/broken.js`);
      const second = await fetch(`${endpoint.origin}/env/lazy/retry.js`);
      expect(first.status).toBe(503);
      expect(second.status).toBe(503);
      expect(activate).toHaveBeenCalledOnce();
      expect(contribution.manifest().envs[0]).toMatchObject({
        status: "failed",
        error: expect.stringContaining("activation exploded"),
      });
      expect(contribution.manifest().envs[0]).not.toHaveProperty("server");
    } finally {
      await contribution.dispose();
      await proxyServer.close();
    }
  }, 20_000);

  it("continues shared activation when the triggering HTTP client disconnects", async () => {
    const fixture = await createContributionSelection(previewHttpVendorUrl(80));
    const proxyServer = new ProxyServer();
    const endpoint = await proxyServer.start("127.0.0.1", 49_200);
    const contribution = await createPreviewCommandContribution(fixture.selection, {
      proxy: endpoint,
      activationMode: "lazy",
    });
    proxyServer.addRoutes(contribution.routes);
    const task = contribution.tasks[0]!;
    const activate = vi.spyOn(task, "activate");

    try {
      await requestAndDisconnect(endpoint.port, "/env/lazy/disconnected.js");
      const next = await fetch(`${endpoint.origin}/env/lazy/next.js`);
      expect(await next.text()).toBe("served:/env/lazy/next.js");
      expect(activate).toHaveBeenCalledOnce();
      expect(contribution.manifest().envs[0]?.status).toBe("ready");
    } finally {
      await contribution.dispose();
      await proxyServer.close();
    }
  }, 20_000);

  it("does not publish an upstream when contribution disposal races with activation", async () => {
    const fixture = await createContributionSelection(previewHttpVendorUrl(200));
    const proxyServer = new ProxyServer();
    const endpoint = await proxyServer.start("127.0.0.1", 49_300);
    const contribution = await createPreviewCommandContribution(fixture.selection, {
      proxy: endpoint,
      activationMode: "lazy",
    });
    proxyServer.addRoutes(contribution.routes);
    const task = contribution.tasks[0]!;

    try {
      const coldRequest = fetch(`${endpoint.origin}/env/lazy/racing.js`);
      await vi.waitFor(() => expect(task.status).toBe("starting"));
      await contribution.dispose();
      const response = await coldRequest;
      expect(response.status).toBe(503);
      expect(contribution.manifest().envs[0]).toMatchObject({ status: "stopped" });
      expect(contribution.manifest().envs[0]).not.toHaveProperty("server");
    } finally {
      await contribution.dispose();
      await proxyServer.close();
    }
  }, 20_000);
});

function createGroup(
  envPackageName: string,
  rootDir: string,
  configFile: string,
  workspaceRoot: string,
  serviceSourcePackageName = envPackageName,
  vendor = "data:text/javascript,export const meta = {}"
): WorkspaceEnvGroup {
  const serviceConfig = {
    vendor,
    config: { configFile },
  };
  const envIdentity = selectedEnv(envPackageName);
  const selectedSource = {
    identity: { packageName: envPackageName, version: "0.0.0" },
    rootDir: workspaceRoot,
    entryFile: path.join(workspaceRoot, "index.json"),
  };
  const serviceSource = {
    identity: { packageName: serviceSourcePackageName, version: "0.0.0" },
    rootDir: workspaceRoot,
    entryFile: path.join(workspaceRoot, "index.json"),
  };
  const service = {
    name: "preview" as const,
    definition: serviceConfig,
    source: serviceSource,
  };
  const env = {
    env: envIdentity,
    package: selectedSource,
    config: undefined,
    services: { preview: service },
    inheritance: serviceSourcePackageName === envPackageName
      ? [selectedSource.identity]
      : [serviceSource.identity, selectedSource.identity],
  };
  const component = {
    id: `scope/${envPackageName}`,
    path: `components/${envPackageName}`,
    rootDir,
    packageName: `@scope/${envPackageName}`,
    kind: "component" as const,
    env: { packageName: envPackageName, version: "workspace:*" },
    mainFile: path.join(rootDir, "index.ts"),
    mainFileRelative: "index.ts",
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    internalDependencyPackageNames: [],
    internalEnvPackageName: undefined,
  };
  return {
    env,
    components: [component],
  };
}

function createWorkspace(rootDir: string, groups: WorkspaceEnvGroup[]): Workspace {
  const components = groups.flatMap((group) => group.components);
  return {
    rootDir,
    configPath: path.join(rootDir, "bit-lite.json"),
    config: {
      components: components.map((component) => ({
        path: component.path,
        id: component.id,
        packageName: component.packageName,
        env: component.env,
      })),
    },
    components,
  };
}

function selectedEnv(packageName: string) {
  return { packageName, requestedVersion: "workspace:*", installedVersion: "0.0.0" };
}

function previewVendorUrl() {
  const target = toDataModule(`
    export default function start(runtime) {
      runtime.postMessage({ type: "ready" });
      runtime.postMessage({
        type: "result",
        data: { mode: "serve", port: runtime.data.runtime.server.preferredPort }
      });
      return { stop() {} };
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "preview-fixture",
      label: "Preview Fixture",
      hint: "Preview fixture",
      moduleUrl: ${JSON.stringify(target)}
    };
  `);
}

async function createContributionSelection(vendor: string) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-preview-lazy-"));
  const componentRoot = path.join(workspaceRoot, "components", "lazy");
  await mkdir(componentRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(workspaceRoot, "package.json"), '{"type":"module"}\n', "utf8"),
    writeFile(path.join(componentRoot, "lazy.docs.md"), "# Lazy docs\n", "utf8"),
    writeFile(path.join(workspaceRoot, "vite.mjs"), "export default {};\n", "utf8"),
  ]);
  const group = createGroup("lazy", componentRoot, "./vite.mjs", workspaceRoot, "lazy", vendor);
  const workspace = createWorkspace(workspaceRoot, [group]);
  const context: WorkspaceContext = {
    workspace,
    components: group.components.map((component) => ({ component, env: group.env })),
  };
  const parsed: ParsedCliArgs = {
    command: "preview",
    args: { raw: ["preview", "--lazy"], options: { lazy: true }, passthrough: [] },
    workspaceRoot,
    componentFilters: [],
    help: false,
  };
  return {
    selection: { parsed, context, components: workspace.components, groups: [group] },
  };
}

function previewHttpVendorUrl(delayMs = 0) {
  const target = toDataModule(`
    import http from "node:http";
    export default async function start(runtime) {
      await new Promise((resolve) => setTimeout(resolve, ${delayMs}));
      const server = http.createServer((request, response) => response.end("served:" + request.url));
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, runtime.data.runtime.server.host, resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing actual address");
      runtime.postMessage({ type: "ready" });
      runtime.postMessage({ type: "result", data: { mode: "serve", port: address.port } });
      runtime.postMessage({ type: "status", status: "ready" });
      return {
        stop() {
          return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        }
      };
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "preview-http-fixture",
      label: "Preview HTTP Fixture",
      hint: "Preview HTTP fixture",
      moduleUrl: ${JSON.stringify(target)}
    };
  `);
}

function requestAndDisconnect(port: number, pathname: string) {
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`GET ${pathname} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      resolve();
    });
    socket.on("error", reject);
  });
}

function previewFailingVendorUrl() {
  const target = toDataModule(`
    export default async function start() {
      throw new Error("activation exploded");
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "preview-failing-fixture",
      label: "Preview Failing Fixture",
      hint: "Preview failing fixture",
      moduleUrl: ${JSON.stringify(target)}
    };
  `);
}

function toDataModule(source: string) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { parseCliArguments } from "bit-lite-context";
import { ProxyServer } from "bit-lite-proxy";
import { stopVendorTasks } from "bit-lite-vendors";
import { describe, expect, it, vi } from "vitest";
import type { Workspace, WorkspaceComponent, WorkspaceEnvGroup } from "bit-lite-context";
import type { ResolvedCommandSelection } from "../utils/command-selection.js";
import { createPreviewCommandContribution } from "./preview.js";
import { createStartSourceCatalog } from "./start-source.js";
import { createStartRoutes } from "./start.js";
import { createTestWatchContribution } from "./test.js";

describe("lazy preview end-to-end", () => {
  it.each([
    ["vite", "demo-vendors/previewers/vite", "demo-config/previewers/vite-static"],
    ["webpack", "demo-vendors/previewers/webpack", "./webpack.mjs"],
  ] as const)("activates only the requested %s env and proxies the cold child request", async (
    name,
    vendor,
    configFile
  ) => {
    const workspaceRoot = await createWorkspaceRoot(name);
    const selection = await createSelection(workspaceRoot, name, vendor, configFile);
    const blockers = (await Promise.all([6000, 6001].map(occupyPort))).filter(
      (server): server is net.Server => server !== undefined
    );
    const proxy = new ProxyServer();
    const endpoint = await proxy.start("127.0.0.1", name === "vite" ? 45_500 : 45_600);
    const contribution = await createPreviewCommandContribution(selection, {
      proxy: endpoint,
      host: endpoint.host,
      activationMode: "lazy",
    });
    proxy.addRoutes(contribution.routes);
    const [firstTask, secondTask] = contribution.tasks;
    if (!firstTask || !secondTask) throw new Error("expected two prepared preview tasks");
    const firstActivate = vi.spyOn(firstTask, "activate");
    const secondActivate = vi.spyOn(secondTask, "activate");

    try {
      expect(contribution.manifest().envs).toMatchObject([
        { status: "idle", preferredPort: 6000, fallbackStartPort: 6002 },
        { status: "idle", preferredPort: 6001, fallbackStartPort: 6002 },
      ]);
      expect(firstTask.canAttach).toBe(false);
      expect(secondTask.canAttach).toBe(false);

      const firstPath = `/env/lazy-${name}-a/__bit-lite/preview.js?cold=1`;
      const firstResponse = await fetch(`${endpoint.origin}${firstPath}`);
      expect(firstResponse.status).toBe(200);
      expect((await firstResponse.text()).length).toBeGreaterThan(0);
      expect(firstActivate).toHaveBeenCalledOnce();
      expect(secondActivate).not.toHaveBeenCalled();
      expect(contribution.manifest().envs).toMatchObject([
        { status: "ready", server: { port: expect.any(Number) } },
        { status: "idle" },
      ]);

      const readyResponse = await fetch(`${endpoint.origin}/env/lazy-${name}-a/`);
      expect(readyResponse.status).toBe(200);
      expect(firstActivate).toHaveBeenCalledOnce();

      const secondResponse = await fetch(
        `${endpoint.origin}/env/lazy-${name}-b/__bit-lite/preview.js?cold=2`
      );
      expect(secondResponse.status).toBe(200);
      expect((await secondResponse.text()).length).toBeGreaterThan(0);
      expect(secondActivate).toHaveBeenCalledOnce();
      const manifest = contribution.manifest();
      expect(manifest.envs.map((env) => env.status)).toEqual(["ready", "ready"]);
      expect(new Set(manifest.envs.map((env) => env.server?.port)).size).toBe(2);
      expect(manifest.envs.every((env) => (env.server?.port ?? 0) >= 6002)).toBe(true);

      if (name === "vite") {
        const basePath = "/env/lazy-vite-a/";
        const hmrClient = await fetch(`${endpoint.origin}${basePath}@vite/client`).then((response) => response.text());
        const token = /const wsToken = "([^"]+)"/.exec(hmrClient)?.[1];
        if (!token) throw new Error("Vite client did not expose an HMR token");
        const socket = await connectViteHmr(endpoint.origin, basePath, token);
        socket.close();
      } else {
        const hmr = await fetch(`${endpoint.origin}/env/lazy-webpack-a/__bit-lite/__webpack_hmr`);
        expect(hmr.status).toBe(200);
        expect(hmr.headers.get("content-type")).toContain("text/event-stream");
        await hmr.body?.cancel();
      }
    } finally {
      await stopVendorTasks(contribution.tasks);
      await contribution.dispose();
      await proxy.close();
      await Promise.all(blockers.map(closeServer));
      await removeWorkspace(workspaceRoot);
    }
  }, 60_000);

  it.each(["eager", "lazy"] as const)(
    "proxies Webpack HMR event traffic through combined start routes in %s mode",
    async (activationMode) => {
      const workspaceRoot = await createWorkspaceRoot(`start-webpack-${activationMode}`);
      const selection = await createSelection(
        workspaceRoot,
        `start-webpack-${activationMode}`,
        "demo-vendors/previewers/webpack",
        "./webpack.mjs"
      );
      const proxy = new ProxyServer();
      const endpoint = await proxy.start("127.0.0.1", activationMode === "eager" ? 45_700 : 45_800);
      const preview = await createPreviewCommandContribution(selection, {
        proxy: endpoint,
        host: endpoint.host,
        activationMode,
      });
      const test = await createTestWatchContribution(selection);
      proxy.addRoutes(createStartRoutes(endpoint, preview, test, createStartSourceCatalog(selection.components)));
      proxy.addRoutes(preview.routes);
      proxy.addRoutes(test.routes);

      try {
        expect((await fetch(`${endpoint.origin}/`)).status).toBe(200);
        if (activationMode === "eager") {
          await vi.waitFor(() => expect(preview.manifest().envs[0]?.status).toBe("ready"), { timeout: 20_000 });
        } else {
          expect(preview.manifest().envs[0]?.status).toBe("idle");
        }

        const basePath = `/env/lazy-start-webpack-${activationMode}-a/`;
        const hmr = await fetch(`${endpoint.origin}${basePath}__bit-lite/__webpack_hmr`);
        expect(hmr.status).toBe(200);
        expect(hmr.headers.get("content-type")).toContain("text/event-stream");
        await hmr.body?.cancel();
        expect(preview.manifest().envs[0]?.status).toBe("ready");
      } finally {
        await stopVendorTasks([...preview.tasks, ...test.tasks]);
        await test.dispose();
        await preview.dispose();
        await proxy.close();
        await removeWorkspace(workspaceRoot);
      }
    },
    60_000
  );
});

async function createWorkspaceRoot(name: string) {
  const tempRoot = path.join(repoRoot(), "packages", "demo-workspace", ".bit-lite");
  await mkdir(tempRoot, { recursive: true });
  const workspaceRoot = await mkdtemp(path.join(tempRoot, `lazy-${name}-`));
  await writeFile(path.join(workspaceRoot, "package.json"), '{"type":"module"}\n', "utf8");
  await writeFile(path.join(workspaceRoot, "webpack.mjs"), "export default { mode: 'development' };\n", "utf8");
  return workspaceRoot;
}

async function occupyPort(port: number) {
  const server = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    return server;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") return undefined;
    throw error;
  }
}

function closeServer(server: net.Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function connectViteHmr(origin: string, basePath: string, token: string) {
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
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`Failed connecting to ${url}`));
    }, { once: true });
  });
}

async function createSelection(
  workspaceRoot: string,
  name: string,
  vendor: string,
  configFile: string
): Promise<ResolvedCommandSelection> {
  const components = await Promise.all(["a", "b"].map(async (suffix) => {
    const rootDir = path.join(workspaceRoot, "components", suffix);
    await mkdir(rootDir, { recursive: true });
    await writeFile(path.join(rootDir, "index.ts"), `export const value = ${JSON.stringify(suffix)};\n`, "utf8");
    return createComponent(rootDir, name, suffix);
  }));
  const workspace: Workspace = {
    rootDir: workspaceRoot,
    configPath: path.join(workspaceRoot, "bit-lite.json"),
    config: {
      components: components.map((component) => ({
        id: component.id,
        path: component.path,
        packageName: component.packageName,
        env: component.env,
      })),
    },
    components,
  };
  const groups = components.map<WorkspaceEnvGroup>((component, index) => {
    const env = selectedEnv(`lazy-${name}-${index === 0 ? "a" : "b"}`);
    const source = {
      identity: { packageName: env.packageName, version: "1.0.0" },
      rootDir: workspaceRoot,
      entryFile: path.join(workspaceRoot, "env.json"),
    };
    const service = {
      name: "preview" as const,
      definition: { vendor, config: { configFile } },
      source,
    };
    return {
      env: {
        env,
        package: source,
        config: undefined,
        services: { preview: service },
        inheritance: [source.identity],
      },
      components: [component],
    };
  });
  const args = parseCliArguments(["--lazy"]);
  return {
    parsed: {
      command: "preview",
      args,
      workspaceRoot,
      componentFilters: [],
      help: false,
    },
    context: {
      workspace,
      components: groups.map((group) => ({ component: group.components[0]!, env: group.env })),
    },
    components,
    groups,
  };
}

function createComponent(rootDir: string, name: string, suffix: string): WorkspaceComponent {
  return {
    id: `components/${suffix}`,
    path: `components/${suffix}`,
    rootDir,
    packageName: `@fixture/${name}-${suffix}`,
    kind: "component",
    env: { packageName: `lazy-${name}-${suffix}`, version: "1.0.0" },
    mainFile: path.join(rootDir, "index.ts"),
    mainFileRelative: "index.ts",
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    internalDependencyPackageNames: [],
    internalEnvPackageName: undefined,
  };
}

function selectedEnv(packageName: string) {
  return { packageName, requestedVersion: "1.0.0", installedVersion: "1.0.0" };
}

function repoRoot() {
  const cwd = process.cwd();
  return path.basename(cwd) === "bit-lite" && path.basename(path.dirname(cwd)) === "packages"
    ? path.resolve(cwd, "../..")
    : cwd;
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
  throw new Error(`lazy preview E2E workspace remained after cleanup: ${workspaceRoot}`);
}

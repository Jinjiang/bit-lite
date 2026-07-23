import { readFile } from "node:fs/promises";
import { ProxyServer } from "bit-lite-proxy";
import { RawOutputBuffer } from "bit-lite-terminal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStartSourceCatalog } from "./start-source.js";
import { createStartManifest, createStartRoutes } from "./start.js";
import { createTestResultRoutes, readComponentTestSnapshot, serializeTerminalOutput } from "./test-routes.js";
import type { PreviewCommandContribution } from "./preview.js";
import {
  createTestWatchResultStore,
  type TestServiceResult,
  type TestWatchContribution,
} from "./test.js";
import type {
  EnvContext,
  SelectedEnvIdentity,
  Workspace,
  WorkspaceComponent,
  WorkspaceEnvGroup,
} from "bit-lite-context";
import type { ProxyEndpoint } from "bit-lite-proxy";
import type { VendorContext, VendorTask } from "bit-lite-vendors";

const servers: ProxyServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.restoreAllMocks();
});

describe("start test read model", () => {
  it("keeps the latest matching task event that actually contains the requested component", () => {
    const contribution = createTestContribution(["scope/a", "scope/b"]);
    addResult(contribution, contribution.tasks[0]!.id, 1, [componentResult("scope/a", 1), componentResult("scope/b", 1)]);
    addResult(contribution, contribution.tasks[0]!.id, 2, [componentResult("scope/b", 2)]);
    addResult(contribution, "test:other-task", 3, [componentResult("scope/a", 3)]);

    expect(readComponentTestSnapshot(contribution, "scope/a")?.result).toMatchObject({
      run: 1,
      stats: { summary: "1/1 passed" },
    });
    expect(readComponentTestSnapshot(contribution, "scope/b")?.result).toMatchObject({
      run: 2,
      stats: { summary: "2/2 passed" },
    });
    expect(readComponentTestSnapshot(contribution, "scope/missing")).toBeUndefined();
  });

  it("uses selected child env identity while the service source remains inherited", () => {
    const contribution = createTestContribution(["scope/a"]);
    const snapshot = readComponentTestSnapshot(contribution, "scope/a");

    expect(contribution.tasks[0]?.context.service.source.identity.packageName).toBe("parent-env");
    expect(snapshot?.env).toEqual(selectedEnv("child-env"));
    expect(snapshot).not.toHaveProperty("envName");
  });

  it("renders retained env output as safe plain text without claiming component attribution", () => {
    const output = new RawOutputBuffer({ limitBytes: 64 });
    output.append("stdout", "\u001b[31m<script>alert(1)</script>\u001b[0m\rprogress");
    const snapshot = readComponentTestSnapshot(createTestContribution(["scope/a"], output), "scope/a");

    expect(snapshot?.terminal).toEqual({
      scope: "env",
      text: "<script>alert(1)</script>\nprogress",
    });
    expect(snapshot?.notices.join(" ")).toContain("may include other components");
    expect(snapshot?.notices.join(" ")).toContain("latest output currently retained");
  });

  it("serializes only chunks retained by the bounded raw output buffer", () => {
    const output = new RawOutputBuffer({ limitBytes: 5 });
    output.append("stdout", "12345");
    output.append("stderr", "678");
    expect(serializeTerminalOutput(output.entries())).toBe("678");
  });

  it("shows env terminal output while the component result is still pending", () => {
    const output = new RawOutputBuffer();
    output.append("stdout", "collecting tests\n");
    const snapshot = readComponentTestSnapshot(createTestContribution(["scope/a"], output), "scope/a");
    expect(snapshot?.result).toBeNull();
    expect(snapshot?.terminal.text).toBe("collecting tests\n");
  });
});

describe("start and test routes", () => {
  it("serves encoded component data with read-only methods and no rerun route", async () => {
    const test = createTestContribution(["scope/a b"]);
    addResult(test, test.tasks[0]!.id, 1, [componentResult("scope/a b", 1)]);
    const server = track(new ProxyServer());
    server.addRoutes(createTestResultRoutes(test));
    await server.start("127.0.0.1", 47_000);

    const query = new URLSearchParams({ component: "scope/a b" });
    const page = await fetch(`${server.origin}/tests?${query}`);
    expect(page.status).toBe(200);
    const pageHtml = await page.text();
    expect(pageHtml).toContain("textContent");
    expect(pageHtml.toLowerCase()).not.toContain("rerun");

    const data = await fetch(`${server.origin}/__bit-lite/test-results.json?${query}`).then((response) => response.json());
    expect(data).toMatchObject({ componentId: "scope/a b", env: selectedEnv("child-env"), result: { run: 1 } });
    expect(data).not.toHaveProperty("envName");

    const unknown = await fetch(`${server.origin}/__bit-lite/test-results.json?component=unknown`);
    expect(unknown.status).toBe(404);
    const post = await fetch(`${server.origin}/__bit-lite/test-results.json?${query}`, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET");
    expect((await fetch(`${server.origin}/__bit-lite/test-rerun`, { method: "POST" })).status).toBe(404);
  });

  it("combines structured preview and test state and exposes live task status", async () => {
    const endpoint: ProxyEndpoint = { origin: "http://127.0.0.1:47010", host: "127.0.0.1", port: 47_010 };
    const preview = createPreviewContribution(endpoint);
    const test = createTestContribution(["scope/preview", "scope/test-only"]);
    const first = createStartManifest(endpoint, preview, test);

    expect(first.components).toMatchObject([
      {
        componentId: "scope/preview",
        env: selectedEnv("child-env"),
        source: { route: "/source?component=scope%2Fpreview" },
        preview: { overviewRoute: "/env/child-env/#scope%2Fpreview" },
        test: { status: "watching" },
      },
      {
        componentId: "scope/source-only",
        env: selectedEnv("child-env"),
        source: { route: "/source?component=scope%2Fsource-only" },
      },
      {
        componentId: "scope/test-only",
        env: selectedEnv("child-env"),
        source: { route: "/source?component=scope%2Ftest-only" },
        test: { status: "watching" },
      },
    ]);
    expect(first.components[1]).not.toHaveProperty("preview");
    expect(first.components[1]).not.toHaveProperty("test");
    expect(first.preview).not.toHaveProperty("unavailable");
    expect(JSON.stringify(first)).not.toContain("envName");
    test.tasks[0]!.status = "running";
    expect(createStartManifest(endpoint, preview, test).tests[0]?.status).toBe("running");

    const server = track(new ProxyServer());
    const sourceCatalog = createStartSourceCatalog(preview.groups.flatMap((group) => group.components));
    server.addRoutes(createStartRoutes(endpoint, preview, test, sourceCatalog));
    await server.start("127.0.0.1", 47_010);
    const html = await fetch(`${server.origin}/`).then((response) => response.text());
    expect(html).toContain("bit-lite start");
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
    const manifest = await fetch(`${server.origin}/__bit-lite/manifest.json`).then((response) => response.json());
    expect(manifest.tests[0].status).toBe("running");
    expect(manifest.tests[0].env).toEqual(selectedEnv("child-env"));
    expect(manifest.components[0].source.route).toBe("/source?component=scope%2Fpreview");
  });

  it("ships test and shell pages as source assets", async () => {
    const testPage = await readFile(new URL("../assets/start-test.html", import.meta.url), "utf8");
    const shell = await readFile(new URL("../assets/start-shell.html", import.meta.url), "utf8");
    const sourcePage = await readFile(new URL("../assets/start-source.html", import.meta.url), "utf8");
    expect(testPage).toContain("Latest structured result");
    expect(testPage.toLowerCase()).not.toContain("rerun");
    expect(testPage).toContain("data.env");
    expect(shell).toContain("/__bit-lite/manifest.json");
    expect(shell).toContain("component.source.route");
    expect(sourcePage).toContain("/__bit-lite/source-files.json");
    expect(sourcePage).toContain("/__bit-lite/source-file.json");
    expect(sourcePage).toContain("textContent");
    expect(sourcePage).not.toContain("innerHTML");
    expect(sourcePage).not.toContain("contenteditable");
    expect(sourcePage).not.toContain("<textarea");
    expect(sourcePage).not.toContain('method="POST"');
  });
});

function createTestContribution(componentIds: string[], rawOutput = new RawOutputBuffer()): TestWatchContribution {
  const fixture = createFixture(componentIds);
  const task = createTask(fixture.workspace, rawOutput);
  return {
    serviceId: "test",
    tasks: [task],
    routes: [],
    groups: [fixture.group],
    resultStore: createTestWatchResultStore(),
    bindings: [{ task, componentIds }],
    effectiveArgs: { raw: ["start"], options: { watch: true }, passthrough: [] },
    dispose: vi.fn(async () => undefined),
  };
}

function createPreviewContribution(endpoint: ProxyEndpoint): PreviewCommandContribution {
  const fixture = createFixture(["scope/preview", "scope/source-only", "scope/test-only"]);
  const manifest = {
    proxy: endpoint,
    envs: [
      {
        env: selectedEnv("child-env"),
        taskId: 'preview:["child-env","workspace:*"]:vite',
        vendor: "vite",
        status: "ready",
        components: [
          {
            componentId: "scope/preview",
            overviewRoute: "/env/child-env/#scope%2Fpreview",
            compositions: [],
          },
        ],
      },
    ],
  };
  return {
    serviceId: "preview",
    tasks: [],
    routes: [],
    state: {} as PreviewCommandContribution["state"],
    groups: [fixture.group],
    configuredTaskCount: 1,
    preparationFailures: [],
    manifest: () => manifest,
    dispose: vi.fn(async () => undefined),
  };
}

function createTask(workspace: Workspace, rawOutput: RawOutputBuffer): VendorTask<unknown, TestServiceResult> {
  return {
    id: 'test:["child-env","workspace:*"]:vitest',
    label: "Test: Vitest (child-env)",
    context: createVendorContext(workspace),
    vendor: { id: "vitest", label: "Vitest", hint: "Test", moduleUrl: "data:text/javascript," },
    status: "watching",
    rawOutput,
    result: new Promise(() => undefined),
    postMessage() {},
    async stop() {},
  };
}

function createVendorContext(workspace: Workspace): VendorContext {
  return {
    version: 1,
    workspace,
    args: { raw: ["start"], options: { watch: true }, passthrough: [] },
    env: selectedEnv("child-env"),
    service: {
      name: "test",
      source: {
        identity: { packageName: "parent-env", version: "1.0.0" },
        rootDir: "/workspace/parent-env",
        entryFile: "/workspace/parent-env/index.json",
      },
    },
  };
}

function createFixture(componentIds: string[]) {
  const components = componentIds.map(createComponent);
  const env = createEnv();
  const workspace: Workspace = {
    rootDir: "/workspace",
    configPath: "/workspace/bit-lite.json",
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
  const group: WorkspaceEnvGroup = { env, components };
  return { workspace, group };
}

function createComponent(id: string): WorkspaceComponent {
  return {
    id,
    path: id,
    rootDir: `/workspace/${id}`,
    packageName: `@fixture/${id.replaceAll("/", ".")}`,
    kind: "component",
    env: { packageName: "child-env", version: "workspace:*" },
    mainFile: `/workspace/${id}/index.ts`,
    mainFileRelative: "index.ts",
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    internalDependencyPackageNames: [],
    internalEnvPackageName: undefined,
  };
}

function createEnv(): EnvContext {
  const childLocation = {
    identity: { packageName: "child-env", version: "0.0.0" },
    rootDir: "/workspace/child-env",
    entryFile: "/workspace/child-env/index.json",
  };
  const parentLocation = {
    identity: { packageName: "parent-env", version: "1.0.0" },
    rootDir: "/workspace/parent-env",
    entryFile: "/workspace/parent-env/index.json",
  };
  return {
    env: selectedEnv("child-env"),
    package: childLocation,
    config: undefined,
    services: {
      test: { name: "test", definition: { vendor: "fixture" }, source: parentLocation },
    },
    inheritance: [parentLocation.identity, childLocation.identity],
  };
}

function componentResult(componentId: string, total: number) {
  return {
    componentId,
    files: [`/${componentId}/index.test.ts`],
    stats: {
      total,
      passed: total,
      failed: 0,
      skipped: 0,
      summary: `${total}/${total} passed`,
    },
    durationMs: total,
    errors: [],
  };
}

function addResult(
  contribution: TestWatchContribution,
  taskId: string,
  run: number,
  componentResults: ReturnType<typeof componentResult>[]
) {
  const result: TestServiceResult = {
    mode: "watch",
    run,
    stats: componentResult("env", componentResults.reduce((total, item) => total + item.stats.total, 0)).stats,
    componentResults,
  };
  contribution.resultStore.add({
    observedAt: `2026-07-15T00:00:0${run}.000Z`,
    taskId,
    env: selectedEnv("child-env"),
    vendor: "vitest",
    json: result,
    text: `run ${run}`,
  });
}

function selectedEnv(packageName: string): SelectedEnvIdentity {
  return { packageName, requestedVersion: "workspace:*", installedVersion: "0.0.0" };
}

function track(server: ProxyServer) {
  servers.push(server);
  return server;
}

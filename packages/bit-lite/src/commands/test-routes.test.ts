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
import type { CompileWatchContribution } from "./compile.js";
import type { ResolvedCommandSelection } from "../utils/command-selection.js";
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
    const selection = createSelection(["scope/preview", "scope/source-only", "scope/test-only"]);
    const compile = createCompileContribution(selection, [
      ["scope/preview", "watching"],
      ["env/prerequisite", "ready"],
    ]);
    compile.bindings[0]!.task.rawOutput.append("stderr", "compiler details stay terminal-scoped");
    const first = createStartManifest(endpoint, preview, test, { selection, compile });

    expect(first.components).toMatchObject([
      {
        componentId: "scope/preview",
        env: selectedEnv("child-env"),
        source: { route: "/source?component=scope%2Fpreview" },
        preview: { overviewRoute: "/env/child-env/#scope%2Fpreview" },
        test: { status: "watching" },
        compile: {
          taskId: "compile:scope/preview",
          vendor: "fixture-compiler",
          status: "watching",
        },
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
    expect(first.components[1]).not.toHaveProperty("compile");
    expect(first.compiles).toEqual([
      {
        taskId: "compile:scope/preview",
        componentId: "scope/preview",
        env: selectedEnv("child-env"),
        vendor: "fixture-compiler",
        status: "watching",
      },
      {
        taskId: "compile:env/prerequisite",
        componentId: "env/prerequisite",
        env: selectedEnv("child-env"),
        vendor: "fixture-compiler",
        status: "ready",
      },
    ]);
    expect(first.preview).not.toHaveProperty("unavailable");
    expect(JSON.stringify(first)).not.toContain("envName");
    expect(JSON.stringify(first)).not.toContain("compiler details stay terminal-scoped");
    test.tasks[0]!.status = "running";
    compile.bindings[0]!.task.status = "failed";
    const updated = createStartManifest(endpoint, preview, test, { selection, compile });
    expect(updated.tests[0]?.status).toBe("running");
    expect(updated.compiles[0]?.status).toBe("failed");
    expect(updated.components[0]?.compile?.status).toBe("failed");

    const server = track(new ProxyServer());
    const sourceCatalog = createStartSourceCatalog(selection.components);
    server.addRoutes(createStartRoutes(
      endpoint,
      preview,
      test,
      sourceCatalog,
      { selection, compile }
    ));
    await server.start("127.0.0.1", 47_010);
    const html = await fetch(`${server.origin}/`).then((response) => response.text());
    expect(html).toContain("bit-lite start");
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
    const manifest = await fetch(`${server.origin}/__bit-lite/manifest.json`).then((response) => response.json());
    expect(manifest.tests[0].status).toBe("running");
    expect(manifest.tests[0].env).toEqual(selectedEnv("child-env"));
    expect(manifest.compiles[0]).toMatchObject({
      componentId: "scope/preview",
      status: "failed",
    });
    expect(manifest.compiles[1]).toMatchObject({
      componentId: "env/prerequisite",
      status: "ready",
    });
    expect(manifest.components[0].source.route).toBe("/source?component=scope%2Fpreview");
  });

  it("keeps canonical components visible in a compile-only manifest", () => {
    const endpoint: ProxyEndpoint = { origin: "http://127.0.0.1:47011", host: "127.0.0.1", port: 47_011 };
    const selection = createSelection(["scope/compile-only", "scope/no-compile"]);
    const preview = createPreviewContribution(endpoint);
    preview.groups = [];
    preview.manifest = () => ({ proxy: endpoint, envs: [] });
    const test = createTestContribution([]);
    test.tasks = [];
    test.bindings = [];
    const compile = createCompileContribution(selection, [["scope/compile-only", "watching"]]);

    const manifest = createStartManifest(endpoint, preview, test, { selection, compile });

    expect(manifest.components.map((component) => component.componentId)).toEqual([
      "scope/compile-only",
      "scope/no-compile",
    ]);
    expect(manifest.components[0]).toMatchObject({
      source: { route: "/source?component=scope%2Fcompile-only" },
      compile: { taskId: "compile:scope/compile-only", status: "watching" },
    });
    expect(manifest.components[1]).not.toHaveProperty("compile");
    expect(manifest.preview.envs).toEqual([]);
    expect(manifest.tests).toEqual([]);
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
    expect(shell).toContain("renderCompileTasks");
    expect(shell).toContain("component.compile.status");
    expect(shell).not.toContain("rawOutput");
    expect(shell).not.toContain("compile-rerun");
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

function createCompileContribution(
  selection: ResolvedCommandSelection,
  entries: Array<[componentId: string, status: string]>
): CompileWatchContribution {
  const selectedById = new Map(selection.components.map((component) => [component.id, component]));
  const bindings = entries.map(([componentId, status]) => {
    const component = selectedById.get(componentId) ?? createComponent(componentId);
    const task: VendorTask = {
      id: `compile:${componentId}`,
      label: `Compile: ${componentId}`,
      context: {
        ...createVendorContext(selection.context.workspace),
        service: {
          ...createVendorContext(selection.context.workspace).service,
          name: "compile",
        },
      },
      vendor: {
        id: "fixture-compiler",
        label: "Fixture compiler",
        hint: "Compile",
        moduleUrl: "data:text/javascript,",
      },
      status,
      rawOutput: new RawOutputBuffer(),
      result: new Promise(() => undefined),
      postMessage() {},
      stop() {},
    };
    return { component, task };
  });
  const settled = Promise.resolve();
  return {
    serviceId: "compile",
    tasks: bindings.map(({ task }) => task),
    routes: [],
    plan: {
      components: bindings.map(({ component }) => component),
      layers: [bindings.map(({ component }) => ({
        id: `compile:${component.id}`,
        dependsOn: [],
        value: component,
      }))],
    },
    bindings,
    effectiveArgs: { raw: ["start"], options: { watch: true }, passthrough: [] },
    ready: () => settled,
    dispose: () => settled,
  };
}

function createSelection(componentIds: string[]): ResolvedCommandSelection {
  const fixture = createFixture(componentIds);
  return {
    parsed: {
      command: "start",
      args: { raw: ["start"], options: {}, passthrough: [] },
      workspaceRoot: fixture.workspace.rootDir,
      componentFilters: [],
      help: false,
    },
    context: {
      workspace: fixture.workspace,
      components: fixture.group.components.map((component) => ({
        component,
        env: fixture.group.env,
      })),
    },
    components: fixture.group.components,
    groups: [fixture.group],
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

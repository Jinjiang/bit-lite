import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedCliArgs } from "bit-lite-context";
import type { CompileWatchContribution } from "./compile.js";
import type { PreviewCommandContribution } from "./preview.js";
import type { TestWatchContribution } from "./test.js";
import type { ResolvedCommandSelection } from "../utils/command-selection.js";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  createCompile: vi.fn(),
  selectCompileRoots: vi.fn(),
  createPreview: vi.fn(),
  createTest: vi.fn(),
  proxyStart: vi.fn(),
  proxyAddRoutes: vi.fn(),
  proxyClose: vi.fn(),
  supervise: vi.fn(),
}));

vi.mock("../utils/command-selection.js", () => ({
  prepareResolvedCommandSelection: mocks.prepare,
}));

vi.mock("./compile.js", () => ({
  createCompileWatchContribution: mocks.createCompile,
  selectCompileRootIds: mocks.selectCompileRoots,
  runCompileCommand: vi.fn(),
}));

vi.mock("./preview.js", () => ({
  createPreviewCommandContribution: mocks.createPreview,
  readPreviewLazy: (value: unknown) => value === true,
  runPreviewCommand: vi.fn(),
}));

vi.mock("./test.js", () => ({
  createTestWatchContribution: mocks.createTest,
  runTestCommand: vi.fn(),
}));

vi.mock("bit-lite-vendors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bit-lite-vendors")>();
  return {
    ...actual,
    superviseVendorTasks: mocks.supervise,
  };
});

vi.mock("bit-lite-proxy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bit-lite-proxy")>();
  return {
    ...actual,
    ProxyServer: class {
      start = mocks.proxyStart;
      addRoutes = mocks.proxyAddRoutes;
      close = mocks.proxyClose;
    },
  };
});

import { runStartCommand } from "./start.js";
import { runCli } from "../cli.js";

const endpoint = { origin: "http://127.0.0.1:47000", host: "127.0.0.1", port: 47_000 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.proxyStart.mockResolvedValue(endpoint);
  mocks.proxyClose.mockResolvedValue(undefined);
  mocks.selectCompileRoots.mockImplementation((selection: ResolvedCommandSelection) =>
    selection.groups.flatMap((group) =>
      group.env.services.compile ? group.components.map((component) => component.id) : []
    )
  );
  mocks.createCompile.mockImplementation(async (_workspace, roots) =>
    createCompileContribution(roots.map((id: string) => task(`compile:${id}`)))
  );
  mocks.createPreview.mockImplementation(async (selection) => createPreviewContribution(selection, []));
  mocks.createTest.mockImplementation(async (selection) => createTestContribution(selection, []));
  mocks.supervise.mockImplementation(async (tasks, options) => {
    const first = options.dispose();
    expect(options.dispose()).toBe(first);
    await first;
    return tasks;
  });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("runStartCommand", () => {
  it("is registered in CLI dispatch and help", async () => {
    mocks.prepare.mockImplementation(async (parsed) => createSelection(parsed, [{}]));

    expect(await runCli(["start"])).toBe(0);
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(await runCli(["--help"])).toBe(0);
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain(
      "start   compile and serve preview/live tests in one watch session"
    );
  });

  it("prepares once and exits before contributions, proxy, or supervision when no service exists", async () => {
    const parsed = createParsed(["start", "--filter", "scope/a"]);
    const resolved = createSelection(parsed, [{}]);
    mocks.prepare.mockResolvedValue(resolved);

    await runStartCommand(parsed);

    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.createCompile).not.toHaveBeenCalled();
    expect(mocks.proxyStart).not.toHaveBeenCalled();
    expect(mocks.createPreview).not.toHaveBeenCalled();
    expect(mocks.createTest).not.toHaveBeenCalled();
    expect(mocks.supervise).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith("No start tasks found.");
  });

  it("waits for compile before preview and test, then supervises all tasks once", async () => {
    const parsed = createParsed(
      ["start", "--filter", "scope/**", "--custom", "value", "--", "vendor-arg"],
      { custom: "value" },
      ["vendor-arg"]
    );
    const original = structuredClone(parsed);
    const resolved = createSelection(parsed, [{ compile: {}, preview: {}, test: {} }]);
    const compileTask = task("compile:scope/component-0");
    const previewTask = task("preview:child:vite");
    const testTask = task("test:child:vitest");
    const compile = createCompileContribution([compileTask]);
    const preview = createPreviewContribution(resolved, [previewTask]);
    const test = createTestContribution(resolved, [testTask]);
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createCompile.mockResolvedValue(compile);
    mocks.createPreview.mockResolvedValue(preview);
    mocks.createTest.mockResolvedValue(test);

    await runStartCommand(parsed);

    expect(mocks.createCompile).toHaveBeenCalledWith(
      resolved.context.workspace,
      ["scope/component-0"],
      parsed.args
    );
    expect(compile.ready).toHaveBeenCalledOnce();
    expect(compile.ready.mock.invocationCallOrder[0]).toBeLessThan(mocks.proxyStart.mock.invocationCallOrder[0]!);
    expect(compile.ready.mock.invocationCallOrder[0]).toBeLessThan(mocks.createPreview.mock.invocationCallOrder[0]!);
    expect(compile.ready.mock.invocationCallOrder[0]).toBeLessThan(mocks.createTest.mock.invocationCallOrder[0]!);
    expect(mocks.createPreview).toHaveBeenCalledWith(resolved, {
      proxy: endpoint,
      host: endpoint.host,
      activationMode: "eager",
    });
    expect(mocks.createTest).toHaveBeenCalledWith(resolved);
    expect(mocks.supervise).toHaveBeenCalledOnce();
    expect(mocks.supervise.mock.calls[0]?.[0]).toEqual([compileTask, previewTask, testTask]);
    expect(parsed).toEqual(original);
    expect(test.dispose).toHaveBeenCalledOnce();
    expect(preview.dispose).toHaveBeenCalledOnce();
    expect(compile.dispose).toHaveBeenCalledOnce();
    expect(mocks.proxyClose).toHaveBeenCalledOnce();
    const rootDispose = mocks.supervise.mock.calls[0]?.[1].dispose;
    expect(rootDispose()).toBe(rootDispose());
    expect(preview.dispose).toHaveBeenCalledOnce();
    expect(test.dispose).toHaveBeenCalledOnce();
    expect(mocks.proxyClose).toHaveBeenCalledOnce();
    expect(test.dispose.mock.invocationCallOrder[0]).toBeLessThan(compile.dispose.mock.invocationCallOrder[0]!);
    expect(preview.dispose.mock.invocationCallOrder[0]).toBeLessThan(compile.dispose.mock.invocationCallOrder[0]!);
    expect(compile.dispose.mock.invocationCallOrder[0]).toBeLessThan(mocks.proxyClose.mock.invocationCallOrder[0]!);
  });

  it("applies lazy mode only to preview while compile and test stay eager", async () => {
    const parsed = createParsed(["start", "--lazy"], { lazy: true });
    const resolved = createSelection(parsed, [{ compile: {}, preview: {}, test: {} }]);
    const compileTask = task("compile:scope/component-0", "watching");
    const previewTask = task("preview:child:vite", "idle");
    const testTask = task("test:child:vitest", "watching");
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createCompile.mockResolvedValue(createCompileContribution([compileTask]));
    mocks.createPreview.mockResolvedValue(createPreviewContribution(resolved, [previewTask]));
    mocks.createTest.mockResolvedValue(createTestContribution(resolved, [testTask]));

    await runStartCommand(parsed);

    expect(mocks.createPreview).toHaveBeenCalledWith(resolved, {
      proxy: endpoint,
      host: endpoint.host,
      activationMode: "lazy",
    });
    expect(mocks.supervise.mock.calls[0]?.[0]).toEqual([compileTask, previewTask, testTask]);
  });

  it("opens the central proxy and UI lifecycle for a compile-only selection", async () => {
    const parsed = createParsed(["start"]);
    const resolved = createSelection(parsed, [{ compile: {} }]);
    const compileTask = task("compile:scope/component-0");
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createCompile.mockResolvedValue(createCompileContribution([compileTask]));

    await runStartCommand(parsed);

    expect(mocks.proxyStart).toHaveBeenCalledOnce();
    expect(mocks.createPreview).toHaveBeenCalledOnce();
    expect(mocks.createTest).toHaveBeenCalledOnce();
    expect(mocks.proxyAddRoutes).toHaveBeenCalledTimes(3);
    expect(mocks.supervise.mock.calls[0]?.[0]).toEqual([compileTask]);
  });

  it("keeps preview and test when the selected component has no compile service", async () => {
    const parsed = createParsed(["start"]);
    const resolved = createSelection(parsed, [{ preview: {}, test: {} }]);
    const previewTask = task("preview:child:vite");
    const testTask = task("test:child:vitest");
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createPreview.mockResolvedValue(createPreviewContribution(resolved, [previewTask]));
    mocks.createTest.mockResolvedValue(createTestContribution(resolved, [testTask]));

    await runStartCommand(parsed);

    expect(mocks.createCompile).toHaveBeenCalledWith(resolved.context.workspace, [], parsed.args);
    expect(mocks.supervise.mock.calls[0]?.[0]).toEqual([previewTask, testTask]);
  });

  it("rolls back compile and does not start later resources when compile readiness fails", async () => {
    const parsed = createParsed(["start"]);
    const resolved = createSelection(parsed, [{ compile: {}, preview: {}, test: {} }]);
    const compile = createCompileContribution([task("compile:scope/component-0")]);
    compile.ready.mockRejectedValue(new Error("initial compile failed"));
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createCompile.mockResolvedValue(compile);

    await expect(runStartCommand(parsed)).rejects.toThrow("initial compile failed");

    expect(mocks.proxyStart).not.toHaveBeenCalled();
    expect(mocks.createPreview).not.toHaveBeenCalled();
    expect(mocks.createTest).not.toHaveBeenCalled();
    expect(compile.dispose).toHaveBeenCalledOnce();
  });

  it("disposes ready compile work when the central proxy cannot start", async () => {
    const parsed = createParsed(["start"]);
    const resolved = createSelection(parsed, [{ compile: {}, preview: {} }]);
    const compile = createCompileContribution([task("compile:scope/component-0")]);
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createCompile.mockResolvedValue(compile);
    mocks.proxyStart.mockRejectedValue(new Error("proxy bind failed"));

    await expect(runStartCommand(parsed)).rejects.toThrow("proxy bind failed");

    expect(compile.dispose).toHaveBeenCalledOnce();
    expect(mocks.createPreview).not.toHaveBeenCalled();
    expect(mocks.createTest).not.toHaveBeenCalled();
    expect(mocks.proxyClose).not.toHaveBeenCalled();
  });

  it("rolls back every created contribution when a later contribution fails", async () => {
    const parsed = createParsed(["start"]);
    const resolved = createSelection(parsed, [{ compile: {}, preview: {}, test: {} }]);
    const compile = createCompileContribution([task("compile:scope/component-0")]);
    const preview = createPreviewContribution(resolved, [task("preview:child:vite")]);
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createCompile.mockResolvedValue(compile);
    mocks.createPreview.mockResolvedValue(preview);
    mocks.createTest.mockRejectedValue(new Error("test startup failed"));

    await expect(runStartCommand(parsed)).rejects.toThrow("test startup failed");

    expect(preview.dispose).toHaveBeenCalledOnce();
    expect(compile.dispose).toHaveBeenCalledOnce();
    expect(mocks.proxyClose).toHaveBeenCalledOnce();
    expect(preview.dispose.mock.invocationCallOrder[0]).toBeLessThan(compile.dispose.mock.invocationCallOrder[0]!);
    expect(compile.dispose.mock.invocationCallOrder[0]).toBeLessThan(mocks.proxyClose.mock.invocationCallOrder[0]!);
  });

  it("rolls back all contributions when route registration fails", async () => {
    const parsed = createParsed(["start"]);
    const resolved = createSelection(parsed, [{ compile: {}, preview: {}, test: {} }]);
    const compile = createCompileContribution([task("compile:scope/component-0")]);
    const preview = createPreviewContribution(resolved, [task("preview:child:vite")]);
    const test = createTestContribution(resolved, [task("test:child:vitest")]);
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createCompile.mockResolvedValue(compile);
    mocks.createPreview.mockResolvedValue(preview);
    mocks.createTest.mockResolvedValue(test);
    mocks.proxyAddRoutes.mockImplementationOnce(() => undefined).mockImplementationOnce(() => {
      throw new Error("duplicate route");
    });

    await expect(runStartCommand(parsed)).rejects.toThrow("duplicate route");

    expect(test.dispose).toHaveBeenCalledOnce();
    expect(preview.dispose).toHaveBeenCalledOnce();
    expect(compile.dispose).toHaveBeenCalledOnce();
    expect(mocks.proxyClose).toHaveBeenCalledOnce();
    expect(test.dispose.mock.invocationCallOrder[0]).toBeLessThan(preview.dispose.mock.invocationCallOrder[0]!);
    expect(preview.dispose.mock.invocationCallOrder[0]).toBeLessThan(compile.dispose.mock.invocationCallOrder[0]!);
    expect(compile.dispose.mock.invocationCallOrder[0]).toBeLessThan(mocks.proxyClose.mock.invocationCallOrder[0]!);
  });

  it("attempts every cleanup and combines initiating and cleanup failures", async () => {
    const parsed = createParsed(["start"]);
    const resolved = createSelection(parsed, [{ compile: {}, preview: {}, test: {} }]);
    const compile = createCompileContribution([task("compile:scope/component-0")]);
    const preview = createPreviewContribution(resolved, [task("preview:child:vite")]);
    compile.dispose.mockRejectedValue(new Error("compile cleanup failed"));
    preview.dispose.mockRejectedValue(new Error("preview cleanup failed"));
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createCompile.mockResolvedValue(compile);
    mocks.createPreview.mockResolvedValue(preview);
    mocks.createTest.mockRejectedValue(new Error("test startup failed"));

    await expect(runStartCommand(parsed)).rejects.toMatchObject({
      message: "bit-lite start failed and cleanup also failed",
      errors: expect.arrayContaining([
        expect.objectContaining({ message: "test startup failed" }),
        expect.objectContaining({ message: "Failed to dispose bit-lite start" }),
      ]),
    });

    expect(preview.dispose).toHaveBeenCalledOnce();
    expect(compile.dispose).toHaveBeenCalledOnce();
    expect(mocks.proxyClose).toHaveBeenCalledOnce();
  });

  it("attempts every child and proxy cleanup after an earlier disposer rejects", async () => {
    const parsed = createParsed(["start"]);
    const resolved = createSelection(parsed, [{ preview: {}, test: {} }]);
    const preview = createPreviewContribution(resolved, [task("preview:child:vite")]);
    const test = createTestContribution(resolved, [task("test:child:vitest")]);
    const testFailure = new Error("test cleanup failed");
    test.dispose.mockRejectedValue(testFailure);
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createPreview.mockResolvedValue(preview);
    mocks.createTest.mockResolvedValue(test);

    const failure = await runStartCommand(parsed).catch((error) => error);

    expect(failure).toBe(testFailure);
    expect(test.dispose).toHaveBeenCalledOnce();
    expect(preview.dispose).toHaveBeenCalledOnce();
    expect(mocks.proxyClose).toHaveBeenCalledOnce();
    expect(test.dispose.mock.invocationCallOrder[0]).toBeLessThan(preview.dispose.mock.invocationCallOrder[0]!);
    expect(preview.dispose.mock.invocationCallOrder[0]).toBeLessThan(mocks.proxyClose.mock.invocationCallOrder[0]!);
  });

  it("reports startup and cleanup failures together after every cleanup settles", async () => {
    const parsed = createParsed(["start"]);
    const resolved = createSelection(parsed, [{ preview: {}, test: {} }]);
    const preview = createPreviewContribution(resolved, [task("preview:child:vite")]);
    const test = createTestContribution(resolved, [task("test:child:vitest")]);
    test.dispose.mockRejectedValue(new Error("test cleanup failed"));
    preview.dispose.mockRejectedValue(new Error("preview cleanup failed"));
    mocks.proxyClose.mockRejectedValue(new Error("proxy cleanup failed"));
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createPreview.mockResolvedValue(preview);
    mocks.createTest.mockResolvedValue(test);
    mocks.proxyAddRoutes.mockImplementationOnce(() => {
      throw new Error("route registration failed");
    });

    const failure = await runStartCommand(parsed).catch((error) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors[0]).toMatchObject({
      message: "route registration failed",
    });
    expect((failure as AggregateError).errors[1]).toBeInstanceOf(AggregateError);
    expect(test.dispose).toHaveBeenCalledOnce();
    expect(preview.dispose).toHaveBeenCalledOnce();
    expect(mocks.proxyClose).toHaveBeenCalledOnce();
  });
});

function createParsed(
  raw: string[],
  options: Record<string, string | boolean> = {},
  passthrough: string[] = []
): ParsedCliArgs {
  return {
    command: "start",
    help: false,
    args: { raw, options, passthrough },
    workspaceRoot: "/workspace",
    componentFilters: [],
  };
}

function createSelection(
  parsed: ParsedCliArgs,
  services: Array<{ compile?: object; preview?: object; test?: object }>
): ResolvedCommandSelection {
  const groups = services.map((configured, index) => ({
    env: {
      env: {
        packageName: `child-${index}`,
        requestedVersion: "workspace:*",
        installedVersion: "0.0.0",
      },
      services: configured,
    },
    components: [{ id: `scope/component-${index}` }],
  }));
  return {
    parsed,
    context: { workspace: { rootDir: "/workspace" } },
    components: groups.flatMap((group) => group.components),
    groups,
  } as unknown as ResolvedCommandSelection;
}

function createCompileContribution(tasks: ReturnType<typeof task>[]) {
  const readyPromise = Promise.resolve();
  const disposePromise = Promise.resolve();
  return {
    serviceId: "compile",
    tasks,
    routes: [],
    plan: { components: [], layers: [[]] },
    bindings: [],
    effectiveArgs: { raw: ["start"], options: { watch: true }, passthrough: [] },
    ready: vi.fn(() => readyPromise),
    dispose: vi.fn(() => disposePromise),
  } as unknown as CompileWatchContribution & {
    ready: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
}

function createPreviewContribution(
  selection: ResolvedCommandSelection,
  tasks: ReturnType<typeof task>[]
) {
  const disposePromise = Promise.resolve();
  return {
    serviceId: "preview",
    tasks,
    routes: [{ id: "preview:route" }],
    state: {},
    groups: selection.groups,
    configuredTaskCount: tasks.length,
    preparationFailures: [],
    manifest: vi.fn(() => ({ proxy: endpoint, envs: [] })),
    dispose: vi.fn(() => disposePromise),
  } as unknown as PreviewCommandContribution & { dispose: ReturnType<typeof vi.fn> };
}

function createTestContribution(
  selection: ResolvedCommandSelection,
  tasks: ReturnType<typeof task>[]
) {
  const disposePromise = Promise.resolve();
  return {
    serviceId: "test",
    tasks,
    routes: [{ id: "test:route" }],
    groups: selection.groups,
    bindings: [],
    effectiveArgs: { raw: ["start"], options: { watch: true }, passthrough: [] },
    resultStore: { entries: () => [] },
    dispose: vi.fn(() => disposePromise),
  } as unknown as TestWatchContribution & { dispose: ReturnType<typeof vi.fn> };
}

function task(id: string, status = "watching") {
  return { id, status };
}

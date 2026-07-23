import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedCliArgs } from "bit-lite-context";
import type { PreviewCommandContribution } from "./preview.js";
import type { TestWatchContribution } from "./test.js";
import type { ResolvedCommandSelection } from "../utils/command-selection.js";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  createPreview: vi.fn(),
  createTest: vi.fn(),
  proxyStart: vi.fn(),
  proxyAddRoutes: vi.fn(),
  proxyClose: vi.fn(),
  supervise: vi.fn(),
  stopTasks: vi.fn(),
}));

vi.mock("../utils/command-selection.js", () => ({
  prepareResolvedCommandSelection: mocks.prepare,
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
    stopVendorTasks: mocks.stopTasks,
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
  mocks.stopTasks.mockResolvedValue(undefined);
  mocks.supervise.mockImplementation(async (_tasks, options) => {
    const cleanup = await options.onTasksStarted?.(_tasks);
    await cleanup?.();
    return _tasks;
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
      "start   serve preview and live test results in one watch session"
    );
  });

  it("prepares once and exits before opening a proxy or watch session when no service is configured", async () => {
    const parsed = createParsed(["start", "--filter", "scope/a"], { filter: "scope/a" });
    const resolved = createSelection(parsed, [{}]);
    mocks.prepare.mockResolvedValue(resolved);

    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");
    await runStartCommand(parsed);

    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.proxyStart).not.toHaveBeenCalled();
    expect(mocks.createPreview).not.toHaveBeenCalled();
    expect(mocks.createTest).not.toHaveBeenCalled();
    expect(mocks.supervise).not.toHaveBeenCalled();
    expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
    expect(console.log).toHaveBeenCalledWith("No start tasks found.");
  });

  it("passes one shared filtered selection to both contributions and supervises all tasks once", async () => {
    const parsed = createParsed(
      ["start", "--filter", "scope/**", "--custom", "value", "--", "vendor-arg"],
      { filter: "scope/**", custom: "value" },
      ["vendor-arg"]
    );
    const original = structuredClone(parsed);
    const resolved = createSelection(parsed, [{ preview: {}, test: {} }]);
    const previewTask = { id: "preview:child:vite" };
    const testTask = { id: "test:child:vitest" };
    const preview = createPreviewContribution(resolved, [previewTask]);
    const test = createTestContribution(resolved, [testTask]);
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createPreview.mockResolvedValue(preview);
    mocks.createTest.mockResolvedValue(test);

    await runStartCommand(parsed);

    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.createPreview).toHaveBeenCalledWith(resolved, {
      proxy: endpoint,
      host: endpoint.host,
      activationMode: "eager",
    });
    expect(mocks.createTest).toHaveBeenCalledWith(resolved);
    expect(mocks.proxyStart).toHaveBeenCalledOnce();
    expect(mocks.proxyAddRoutes).toHaveBeenCalledTimes(3);
    expect(mocks.supervise).toHaveBeenCalledOnce();
    expect(mocks.supervise.mock.calls[0]?.[0]).toEqual([previewTask, testTask]);
    expect(parsed).toEqual(original);
    expect(preview.dispose).toHaveBeenCalledOnce();
    expect(test.dispose).toHaveBeenCalledOnce();
    expect(mocks.proxyClose).toHaveBeenCalledOnce();
    expect(mocks.stopTasks).not.toHaveBeenCalled();
  });

  it("passes lazy mode only to preview while preserving the shared selection for eager tests", async () => {
    const parsed = createParsed(
      ["start", "--lazy", "--custom", "value", "--", "vendor-arg"],
      { lazy: true, custom: "value" },
      ["vendor-arg"]
    );
    const original = structuredClone(parsed);
    const resolved = createSelection(parsed, [{ preview: {}, test: {} }]);
    const previewTask = { id: "preview:child:vite", status: "idle" };
    const testTask = { id: "test:child:vitest", status: "watching" };
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createPreview.mockResolvedValue(createPreviewContribution(resolved, [previewTask]));
    mocks.createTest.mockResolvedValue(createTestContribution(resolved, [testTask]));

    await runStartCommand(parsed);

    expect(mocks.createPreview).toHaveBeenCalledWith(resolved, {
      proxy: endpoint,
      host: endpoint.host,
      activationMode: "lazy",
    });
    expect(mocks.createTest).toHaveBeenCalledWith(resolved);
    expect(mocks.supervise.mock.calls[0]?.[0]).toEqual([previewTask, testTask]);
    expect(parsed).toEqual(original);
  });

  it.each([
    ["preview-only", { preview: {} }, 1, 0],
    ["test-only", { test: {} }, 0, 1],
  ])("runs a %s selected env without requiring the other service", async (_name, services, previewCount, testCount) => {
    const parsed = createParsed(["start"]);
    const resolved = createSelection(parsed, [services]);
    const previewTasks = Array.from({ length: previewCount }, () => ({ id: "preview:child:vite" }));
    const testTasks = Array.from({ length: testCount }, () => ({ id: "test:child:vitest" }));
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createPreview.mockResolvedValue(createPreviewContribution(resolved, previewTasks));
    mocks.createTest.mockResolvedValue(createTestContribution(resolved, testTasks));

    await runStartCommand(parsed);

    expect(mocks.supervise.mock.calls[0]?.[0]).toEqual([...previewTasks, ...testTasks]);
  });

  it("continues with test when preview preparation reports an expected per-env failure", async () => {
    const parsed = createParsed(["start"]);
    const resolved = createSelection(parsed, [{ preview: {}, test: {} }]);
    const testTask = { id: "test:child:vitest" };
    const preview = createPreviewContribution(resolved, []);
    preview.preparationFailures.push({ env: resolved.groups[0]!.env, error: new Error("preview failed") });
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createPreview.mockResolvedValue(preview);
    mocks.createTest.mockResolvedValue(createTestContribution(resolved, [testTask]));

    await runStartCommand(parsed);

    expect(mocks.supervise.mock.calls[0]?.[0]).toEqual([testTask]);
  });

  it("stops earlier tasks before disposing resources when the second contribution fails", async () => {
    const parsed = createParsed(["start"]);
    const resolved = createSelection(parsed, [{ preview: {}, test: {} }]);
    const previewTask = { id: "preview:child:vite" };
    const preview = createPreviewContribution(resolved, [previewTask]);
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createPreview.mockResolvedValue(preview);
    mocks.createTest.mockRejectedValue(new Error("test startup failed"));

    await expect(runStartCommand(parsed)).rejects.toThrow("test startup failed");

    expect(mocks.stopTasks).toHaveBeenCalledWith([previewTask]);
    expect(mocks.stopTasks.mock.invocationCallOrder[0]).toBeLessThan(preview.dispose.mock.invocationCallOrder[0]!);
    expect(preview.dispose.mock.invocationCallOrder[0]).toBeLessThan(mocks.proxyClose.mock.invocationCallOrder[0]!);
  });

  it("stops both contributions before disposal when route registration fails", async () => {
    const parsed = createParsed(["start"]);
    const resolved = createSelection(parsed, [{ preview: {}, test: {} }]);
    const previewTask = { id: "preview:child:vite" };
    const testTask = { id: "test:child:vitest" };
    const preview = createPreviewContribution(resolved, [previewTask]);
    const test = createTestContribution(resolved, [testTask]);
    mocks.prepare.mockResolvedValue(resolved);
    mocks.createPreview.mockResolvedValue(preview);
    mocks.createTest.mockResolvedValue(test);
    mocks.proxyAddRoutes.mockImplementationOnce(() => undefined).mockImplementationOnce(() => {
      throw new Error("duplicate route");
    });

    await expect(runStartCommand(parsed)).rejects.toThrow("duplicate route");

    expect(mocks.stopTasks).toHaveBeenCalledWith([previewTask, testTask]);
    const stopped = mocks.stopTasks.mock.invocationCallOrder[0]!;
    expect(stopped).toBeLessThan(test.dispose.mock.invocationCallOrder[0]!);
    expect(stopped).toBeLessThan(preview.dispose.mock.invocationCallOrder[0]!);
    expect(preview.dispose.mock.invocationCallOrder[0]).toBeLessThan(mocks.proxyClose.mock.invocationCallOrder[0]!);
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
  };
}

function createSelection(
  parsed: ParsedCliArgs,
  services: Array<{ preview?: object; test?: object }>
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

function createPreviewContribution(
  selection: ResolvedCommandSelection,
  tasks: object[]
): PreviewCommandContribution {
  return {
    serviceId: "preview",
    tasks,
    routes: [{ id: "preview:route" }],
    state: {},
    groups: selection.groups,
    configuredTaskCount: tasks.length,
    preparationFailures: [],
    manifest: vi.fn(),
    dispose: vi.fn(),
  } as unknown as PreviewCommandContribution;
}

function createTestContribution(
  selection: ResolvedCommandSelection,
  tasks: object[]
): TestWatchContribution {
  return {
    serviceId: "test",
    tasks,
    routes: [{ id: "test:route" }],
    groups: selection.groups,
    bindings: [],
    effectiveArgs: {},
    dispose: vi.fn(),
  } as unknown as TestWatchContribution;
}

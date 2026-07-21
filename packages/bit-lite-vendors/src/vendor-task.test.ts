import { EventEmitter } from "node:events";
import { parseCliArguments } from "bit-lite-context";
import { RawOutputBuffer } from "bit-lite-terminal";
import { describe, expect, it, vi } from "vitest";
import {
  createWatchVendorTasks,
  runVendorTasks,
  stopVendorTasks,
  superviseVendorTasks,
  watchVendorTasks,
} from "bit-lite-vendors";
import type {
  SelectedEnvIdentity,
  Workspace,
  WorkspaceComponent,
  WorkspaceComponentConfig,
} from "bit-lite-context";
import type { JsonObject, VendorContext } from "./types/index.js";
import type { ManagedTerminalInputStream } from "bit-lite-terminal";
import type { VendorTask, VendorTaskRunResult, VendorTaskStartOptions } from "bit-lite-vendors";

type TestServiceResult = JsonObject & {
  mode: "run" | "watch";
  run: number;
  summary: string;
  componentIds: string[];
  observed: JsonObject;
};

type MixedRunResult = JsonObject & {
  phase: "complete";
  componentCount: number;
  summary: string;
};

type MixedEventResult = JsonObject & {
  phase: "progress";
  componentCount: number;
  detail: string;
};

const testVendorUrl = createTestVendorUrl();
const mixedResultsVendorUrl = createMixedResultsVendorUrl();

describe("vendor task helpers", () => {
  it("runs produced data once and wraps it with parent-owned context and vendor metadata", async () => {
    let printedResults: VendorTaskRunResult<TestServiceResult>[] | undefined;
    let printedTasks: VendorTask<TestServiceResult>[] | undefined;
    const options = createTaskOptions(testVendorUrl, []);

    const results = await runVendorTasks<TestServiceResult>([options], {
      serviceId: "test",
      label: "Test",
      formatResult: formatTestRunResult,
      printResults(resultsToPrint, tasks) {
        printedResults = resultsToPrint;
        printedTasks = tasks;
      },
    });

    expect(results[0]?.context).toBe(options.context);
    expect(results[0]?.vendor.id).toBe("test-fixture");
    expect(results[0]?.data).toMatchObject({
      mode: "run",
      run: 1,
      summary: "1 component(s)",
      componentIds: ["components/demo/button"],
      observed: {
        workspaceComponents: 1,
        serviceSource: "fixture-env",
      },
    });
    expect(results[0]?.data).not.toHaveProperty("env");
    expect(results[0]?.data).not.toHaveProperty("vendor");
    expect(results[0]?.data).not.toHaveProperty("args");
    expect(printedResults).toBe(results);
    expect(printedTasks?.[0]?.label).toBe("Test Fixture (fixture-env)");
  });

  it("uses run data independently from event data", async () => {
    const results = await runVendorTasks<MixedRunResult>([createTaskOptions(mixedResultsVendorUrl, [])], {
      serviceId: "test",
      label: "Mixed",
      formatResult: formatMixedRunResult,
      printResults() {},
    });

    expect(results[0]?.data).toEqual({
      phase: "complete",
      componentCount: 1,
      summary: "run saw 1 component(s)",
    });
  });

  it("crosses the worker boundary with the same serializable context", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    let receivedResult: MixedEventResult | undefined;
    let receivedTask: VendorTask<unknown, MixedEventResult> | undefined;

    try {
      const options = createTaskOptions(mixedResultsVendorUrl, ["--watch", "--coverage", "--", "fixture.ts"]);
      const tasks = await watchVendorTasks<MixedEventResult>([options], {
        serviceId: "test",
        label: "Mixed",
        title: "mixed watch",
        formatResult: formatMixedWatchResult,
        onResult(result, task) {
          receivedResult = result;
          receivedTask = task;
          process.emit("SIGTERM");
        },
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.details).toEqual(["event: event saw 1 component(s)"]);
      expect(tasks[0]?.canAttach).toBe(true);
      expect(receivedTask?.context).toEqual(options.context);
      expect(receivedTask?.context.args.options.coverage).toBe(true);
      expect(receivedTask?.context.args.passthrough).toEqual(["fixture.ts"]);
      expect(receivedResult).not.toHaveProperty("env");
      expect(receivedTask?.context).not.toHaveProperty("envs");
      expect(receivedTask?.context).not.toHaveProperty("groups");
    } finally {
      kill.mockRestore();
    }
  });

  it("transports a representative large workspace without resolved env graphs", async () => {
    const workspace = createWorkspace(400);
    const options = createTaskOptions(testVendorUrl, ["--coverage"], workspace);
    const serialized = JSON.stringify(options.context);

    const results = await runVendorTasks<TestServiceResult>([options], {
      serviceId: "test",
      label: "Test",
      formatResult: formatTestRunResult,
      printResults() {},
    });

    expect(results[0]?.data.observed.workspaceComponents).toBe(400);
    expect(structuredClone(options.context)).toEqual(options.context);
    expect(serialized).not.toContain('"envs"');
    expect(serialized).not.toContain('"groups"');
    expect(serialized).not.toContain('"services"');
    expect(serialized).not.toContain('"inheritance"');
  });

  it("creates caller-owned watch tasks without process or terminal supervision", async () => {
    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");
    const options = createTaskOptions(testVendorUrl, ["--watch"]);
    const tasks = await createWatchVendorTasks<TestServiceResult>([options], {
      serviceId: "test",
      label: "Test",
      formatResult(result) {
        const formatted = formatTestRunResult(result);
        return formatted instanceof Error ? formatted : [formatted.summary];
      },
    });

    try {
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        id: 'test:["fixture-env","workspace:*"]:test-fixture',
        label: "Test: Test Fixture (fixture-env)",
        context: options.context,
        canAttach: true,
      });
      expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
      await vi.waitFor(() => expect(tasks[0]?.details).toEqual(["1 component(s)"]));
    } finally {
      await stopVendorTasks(tasks);
    }
  });

  it("keeps a deferred task idle and coalesces concurrent activation into one worker", async () => {
    const options = createTaskOptions(createDeferredVendorUrl(), ["--watch"]);
    const tasks = await createWatchVendorTasks<TestServiceResult>([options], {
      serviceId: "test",
      label: "Test",
      activation: "deferred",
      formatResult(result) {
        const formatted = formatTestRunResult(result);
        return formatted instanceof Error ? formatted : [formatted.summary];
      },
    });
    const task = tasks[0]!;
    const id = task.id;
    const output: string[] = [];
    const unsubscribe = task.onOutput?.((_stream, chunk) => output.push(chunk.toString("utf8")));

    try {
      expect(task.status).toBe("idle");
      expect(task.canAttach).toBe(false);
      expect(task.details).toEqual([]);

      const firstActivation = task.activate();
      const secondActivation = task.activate();
      expect(secondActivation).toBe(firstActivation);
      expect(task.id).toBe(id);
      expect(task.canAttach).toBe(true);

      await Promise.all([firstActivation, secondActivation]);
      await vi.waitFor(() => expect(task.details).toEqual(["1 component(s)"]));
      await vi.waitFor(() => expect(output.join("")).toContain("deferred worker started"));
      expect(task.id).toBe(id);
      expect(task.status).toBe("ready");
    } finally {
      unsubscribe?.();
      await stopVendorTasks(tasks);
    }
  });

  it("stops an idle deferred task without making it attachable or activatable", async () => {
    const tasks = await createWatchVendorTasks<TestServiceResult>(
      [createTaskOptions(createDeferredVendorUrl(), ["--watch"])],
      {
        serviceId: "test",
        label: "Test",
        activation: "deferred",
        formatResult: () => [],
      }
    );
    const task = tasks[0]!;

    await task.stop();

    expect(await task.exitPromise).toBe(0);
    expect(task.status).toBe("stopped");
    expect(task.canAttach).toBe(false);
    await expect(task.activate()).rejects.toThrow("cannot activate after it was stopped");
  });

  it("stops a worker when shutdown races with deferred activation", async () => {
    const tasks = await createWatchVendorTasks<TestServiceResult>(
      [createTaskOptions(createSlowDeferredVendorUrl(), ["--watch"])],
      {
        serviceId: "test",
        label: "Test",
        activation: "deferred",
        formatResult: () => [],
      }
    );
    const task = tasks[0]!;
    void task.result.catch(() => undefined);
    const activation = task.activate();

    await task.stop();

    await expect(activation).rejects.toThrow();
    expect(await task.exitPromise).toBe(0);
    expect(task.status).toBe("stopped");
  });

  it("derives otherwise identical task IDs from the context service", async () => {
    const testOptions = createTaskOptions(testVendorUrl, ["--watch"]);
    const previewOptions = {
      ...testOptions,
      context: {
        ...testOptions.context,
        service: { ...testOptions.context.service, name: "preview" as const },
      },
    };
    const formatResult = (result: unknown) => {
      const formatted = formatTestRunResult(result);
      return formatted instanceof Error ? formatted : [formatted.summary];
    };
    const testTasks = await createWatchVendorTasks([testOptions], {
      serviceId: "test",
      label: "Test",
      formatResult,
    });
    const previewTasks = await createWatchVendorTasks([previewOptions], {
      serviceId: "preview",
      label: "Preview",
      formatResult,
    });

    try {
      expect(testTasks[0]?.id).toBe('test:["fixture-env","workspace:*"]:test-fixture');
      expect(previewTasks[0]?.id).toBe('preview:["fixture-env","workspace:*"]:test-fixture');
      expect(new Set([...testTasks, ...previewTasks].map((task) => task.id)).size).toBe(2);
    } finally {
      await stopVendorTasks([...testTasks, ...previewTasks]);
    }
  });

  it("supervises task output and input through one interactive terminal", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const firstInput = vi.fn();
    const secondInput = vi.fn();
    const first = createFakeTask("test:first", "First", firstInput);
    const second = createFakeTask("preview:second", "Second", secondInput);
    first.rawOutput.append("stdout", "first buffered\n");
    second.rawOutput.append("stdout", "second buffered\n");

    await superviseVendorTasks([first, second], {
      title: "Combined",
      interactive: true,
      terminal: {
        stdin: input as unknown as ManagedTerminalInputStream,
        stdout: output as unknown as NodeJS.WriteStream,
        stderr: output as unknown as NodeJS.WriteStream,
      },
      onTasksStarted() {
        setImmediate(() => {
          input.emit("keypress", undefined, { name: "down" });
          input.emit("keypress", "\r", { name: "return" });
          input.emit("keypress", "x", { name: "x" });
          input.emit("keypress", undefined, { name: "escape" });
          input.emit("keypress", "q", { name: "q" });
        });
      },
    });

    expect(firstInput).not.toHaveBeenCalled();
    expect(secondInput).toHaveBeenCalledWith("x");
    expect(output.text()).toContain("second buffered");
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });

  it("stops tasks and detaches listeners before contribution cleanup", async () => {
    const events: string[] = [];
    const task = createFakeTask("test:signal", "Signal", vi.fn(), events);
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

    try {
      await superviseVendorTasks([task], {
        title: "Signal",
        interactive: false,
        onTasksStarted() {
          setImmediate(() => {
            process.emit("SIGTERM");
            process.emit("SIGTERM");
          });
          return () => {
            events.push("cleanup");
          };
        },
      });

      expect(events).toEqual(["stop", "unsubscribe-message", "unsubscribe-output", "cleanup"]);
      expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM");
    } finally {
      kill.mockRestore();
    }
  });

  it("stops tasks when supervision setup fails", async () => {
    const task = createFakeTask("test:setup", "Setup", vi.fn());

    await expect(superviseVendorTasks([task], {
      title: "Setup",
      interactive: false,
      onTasksStarted() {
        throw new Error("setup failed");
      },
    })).rejects.toThrow("setup failed");
    expect(task.stop).toHaveBeenCalledOnce();
  });

  it("does not wait forever for hung task termination", async () => {
    const stop = vi.fn();
    const terminate = vi.fn(() => new Promise<void>(() => undefined));
    const task = {
      id: "hung:test",
      label: "Hung Test",
      status: "running",
      rawOutput: new RawOutputBuffer(),
      context: createVendorContext(createWorkspace(1), []),
      vendor: {
        id: "hung",
        label: "Hung",
        hint: "Hung fixture",
        moduleUrl: "data:text/javascript,export default function start() {}",
      },
      result: new Promise(() => undefined),
      exitPromise: new Promise(() => undefined),
      postMessage() {},
      stop,
      terminate,
    } as VendorTask;

    await stopVendorTasks([task], { exitTimeoutMs: 1, terminateTimeoutMs: 1 });

    expect(stop).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("rejects a resolved vendor module without valid metadata", async () => {
    const invalidVendorUrl = toDataModule("export const nope = true;");
    await expect(runVendorTasks<TestServiceResult>([createTaskOptions(invalidVendorUrl, [])], {
      serviceId: "test",
      label: "Test",
      formatResult: formatTestRunResult,
      printResults() {},
    })).rejects.toThrow("must export const meta: VendorDefinition");
  });
});

function createTaskOptions(
  vendorUrl: string,
  rawArgs: string[],
  workspace = createWorkspace(1)
): VendorTaskStartOptions {
  return {
    vendorUrl,
    context: createVendorContext(workspace, rawArgs),
    components: [workspace.components[0]!],
    config: { shard: "unit", retries: 1, coverage: true },
  };
}

function createFakeTask(
  id: string,
  label: string,
  writeInput: ReturnType<typeof vi.fn>,
  events: string[] = []
) {
  const baseContext = createVendorContext(createWorkspace(1), ["--watch"]);
  const context: VendorContext = id.startsWith("preview:")
    ? { ...baseContext, service: { ...baseContext.service, name: "preview" } }
    : baseContext;
  return {
    id,
    label,
    context,
    vendor: {
      id: "fixture",
      label: "Fixture",
      hint: "Fixture task",
      moduleUrl: "data:text/javascript,export default function start() {}",
    },
    status: "watching",
    rawOutput: new RawOutputBuffer(),
    result: new Promise(() => undefined),
    exitPromise: Promise.resolve(0 as const),
    activate: vi.fn(async () => undefined),
    postMessage() {},
    writeInput,
    canAttach: true,
    stop: vi.fn(() => {
      events.push("stop");
    }),
    terminate: vi.fn(),
    onMessage() {
      return () => events.push("unsubscribe-message");
    },
    onOutput() {
      return () => events.push("unsubscribe-output");
    },
  } satisfies VendorTask;
}

class FakeInput extends EventEmitter {
  isRaw = false;
  isTTY = true;

  pause() {
    return this;
  }

  resume() {
    return this;
  }

  setRawMode(mode: boolean) {
    this.isRaw = mode;
    return this as unknown as NodeJS.ReadStream;
  }
}

class FakeOutput extends EventEmitter {
  columns = 100;
  rows = 30;
  chunks: string[] = [];

  write(chunk: string | Uint8Array) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    return true;
  }

  text() {
    return this.chunks.join("");
  }
}

function createVendorContext(workspace: Workspace, rawArgs: string[]): VendorContext {
  return {
    version: 1,
    workspace,
    args: parseCliArguments(rawArgs),
    env: selectedEnv("fixture-env"),
    service: {
      name: "test",
      source: {
        identity: { packageName: "fixture-env", version: "0.0.0" },
        rootDir: "/workspace/env",
        entryFile: "/workspace/env/index.json",
      },
    },
  };
}

function createWorkspace(count: number): Workspace {
  const components = Array.from({ length: count }, (_, index) => createComponent(index));
  return {
    rootDir: "/workspace",
    configPath: "/workspace/bit-lite.json",
    config: {
      components: components.map<WorkspaceComponentConfig>((component) => ({
        id: component.id,
        path: component.path,
        packageName: component.packageName,
        env: component.env,
      })),
    },
    components,
  };
}

function createComponent(index: number): WorkspaceComponent {
  const id = index === 0 ? "components/demo/button" : `components/demo/item-${index}`;
  const packageName = index === 0 ? "@fixture/demo.button" : `@fixture/demo.item-${index}`;
  return {
    id,
    path: id,
    rootDir: `/workspace/${id}`,
    packageName,
    kind: "component",
    env: { packageName: "fixture-env", version: "workspace:*" },
    mainFile: `/workspace/${id}/index.ts`,
    mainFileRelative: "index.ts",
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    internalDependencyPackageNames: [],
    internalEnvPackageName: undefined,
  };
}

function createTestVendorUrl() {
  const targetModule = toDataModule(`
    export default function start(runtime) {
      const componentIds = runtime.data.components.map((component) => component.id);
      const mode = runtime.data.context.args.options.watch === true ? "watch" : "run";
      const data = {
        mode,
        run: 1,
        summary: componentIds.length + " component(s)",
        componentIds,
        observed: {
          workspaceComponents: runtime.data.context.workspace.components.length,
          serviceSource: runtime.data.context.service.source.identity.packageName,
          coverage: runtime.data.context.args.options.coverage === true,
        },
      };
      runtime.postMessage({ type: "ready" });
      if (mode === "watch") {
        runtime.postMessage({ type: "result", data });
        return { stop() {} };
      }
      return { data };
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "test-fixture",
      label: "Test Fixture",
      hint: "Test fixture",
      moduleUrl: ${JSON.stringify(targetModule)}
    };
  `);
}

function createMixedResultsVendorUrl() {
  const targetModule = toDataModule(`
    export default function start(runtime) {
      const componentCount = runtime.data.components.length;
      runtime.postMessage({ type: "ready" });
      runtime.postMessage({ type: "result", data: {
        phase: "progress",
        componentCount,
        detail: "event saw " + componentCount + " component(s)",
      }});
      return {
        data: {
          phase: "complete",
          componentCount,
          summary: "run saw " + componentCount + " component(s)",
        },
        stop() {},
      };
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "mixed-results",
      label: "Mixed Results",
      hint: "Mixed fixture",
      moduleUrl: ${JSON.stringify(targetModule)}
    };
  `);
}

function createDeferredVendorUrl() {
  const targetModule = toDataModule(`
    export default function start(runtime) {
      console.log("deferred worker started");
      const componentIds = runtime.data.components.map((component) => component.id);
      runtime.postMessage({ type: "ready" });
      runtime.postMessage({ type: "result", data: {
        mode: "watch",
        run: 1,
        summary: componentIds.length + " component(s)",
        componentIds,
        observed: {},
      }});
      return { stop() {} };
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "deferred-fixture",
      label: "Deferred Fixture",
      hint: "Deferred fixture",
      moduleUrl: ${JSON.stringify(targetModule)}
    };
  `);
}

function createSlowDeferredVendorUrl() {
  const targetModule = toDataModule(`
    export default async function start(runtime) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      runtime.postMessage({ type: "ready" });
      return { stop() {} };
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "slow-deferred-fixture",
      label: "Slow Deferred Fixture",
      hint: "Slow deferred fixture",
      moduleUrl: ${JSON.stringify(targetModule)}
    };
  `);
}

function toDataModule(source: string) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

function formatTestRunResult(result: unknown) {
  return isRecord(result) && (result.mode === "run" || result.mode === "watch") &&
    typeof result.run === "number" && typeof result.summary === "string" &&
    Array.isArray(result.componentIds) && isRecord(result.observed)
    ? result as TestServiceResult
    : new Error("Invalid test run result");
}

function formatMixedRunResult(value: unknown): MixedRunResult | Error {
  return isRecord(value) && value.phase === "complete" && typeof value.componentCount === "number" &&
    typeof value.summary === "string" ? value as MixedRunResult : new Error("Invalid mixed run result");
}

function formatMixedWatchResult(value: unknown) {
  if (!isRecord(value) || value.phase !== "progress" || typeof value.detail !== "string") {
    return new Error("Invalid mixed event result");
  }
  return [`event: ${value.detail}`];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectedEnv(packageName: string): SelectedEnvIdentity {
  return { packageName, requestedVersion: "workspace:*", installedVersion: "0.0.0" };
}

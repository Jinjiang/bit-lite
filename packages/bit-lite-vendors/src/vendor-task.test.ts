import { EventEmitter } from "node:events";
import { parseCliArguments } from "bit-lite-context";
import { RawOutputBuffer } from "bit-lite-terminal";
import { describe, expect, it, vi } from "vitest";
import {
  createWatchVendorTasks,
  runVendorTasks,
  stopVendorTasks,
  superviseVendorTasks,
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

  it("crosses the worker boundary through explicit creation and supervision", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    let receivedResult: MixedEventResult | undefined;
    let receivedTask: VendorTask<unknown, MixedEventResult> | undefined;

    try {
      const options = createTaskOptions(mixedResultsVendorUrl, ["--watch", "--coverage", "--", "fixture.ts"]);
      const tasks = await createWatchVendorTasks<MixedEventResult>([options], {
        serviceId: "test",
        label: "Mixed",
        activation: "deferred",
        formatResult: formatMixedWatchResult,
        onResult(result, task) {
          receivedResult = result;
          receivedTask = task;
          process.emit("SIGTERM");
        },
      });
      setImmediate(() => void tasks[0]?.activate().catch(() => undefined));
      await superviseVendorTasks(tasks, {
        title: "mixed watch",
        interactive: false,
        dispose: () => stopVendorTasks(tasks),
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
      await expect(tasks[0]?.firstResult).resolves.toMatchObject({
        mode: "watch",
        run: 1,
      });
      await vi.waitFor(() => expect(tasks[0]?.details).toEqual(["1 component(s)"]));
    } finally {
      await stopVendorTasks(tasks);
    }
  });

  it("publishes repeated validated results and does not replay to late subscribers", async () => {
    const tasks = await createWatchVendorTasks<TestServiceResult>(
      [createTaskOptions(createObservableVendorUrl(), ["--watch"])],
      {
        serviceId: "test",
        label: "Test",
        activation: "deferred",
        formatResult(result) {
          const formatted = formatTestRunResult(result);
          return formatted instanceof Error ? formatted : [formatted.summary];
        },
      }
    );
    const task = tasks[0]!;
    const early: number[] = [];
    const late: number[] = [];
    const unsubscribeEarly = task.onResult((result) => early.push(result.run));

    try {
      await task.activate();
      await expect(task.firstResult).resolves.toMatchObject({ run: 1 });
      const unsubscribeLate = task.onResult((result) => late.push(result.run));
      task.postMessage({ again: true });
      await vi.waitFor(() => expect(early).toEqual([1, 2]));
      expect(late).toEqual([2]);
      unsubscribeLate();
    } finally {
      unsubscribeEarly();
      await stopVendorTasks(tasks);
    }
  });

  it("rejects invalid results without publishing them or later payloads", async () => {
    const tasks = await createWatchVendorTasks<TestServiceResult>(
      [createTaskOptions(createInvalidEventVendorUrl(), ["--watch"])],
      {
        serviceId: "test",
        label: "Test",
        activation: "deferred",
        formatResult(result) {
          const formatted = formatTestRunResult(result);
          return formatted instanceof Error ? formatted : [formatted.summary];
        },
      }
    );
    const task = tasks[0]!;
    const observed: TestServiceResult[] = [];
    task.onResult((result) => observed.push(result));
    void task.result.catch(() => undefined);

    try {
      await task.activate();
      await expect(task.firstResult).rejects.toThrow("Invalid test run result");
      await expect(task.result).rejects.toThrow("Invalid test run result");
      expect(observed).toEqual([]);
    } finally {
      await stopVendorTasks(tasks);
    }
  });

  it("rejects first-result observation when activation fails", async () => {
    const tasks = await createWatchVendorTasks<TestServiceResult>(
      [createTaskOptions(createFailingWatchVendorUrl(), ["--watch"])],
      {
        serviceId: "test",
        label: "Test",
        activation: "deferred",
        formatResult: () => [],
      }
    );
    const task = tasks[0]!;
    void task.result.catch(() => undefined);

    await expect(task.activate()).rejects.toThrow("watch startup failed");
    await expect(task.firstResult).rejects.toThrow("watch startup failed");
    await stopVendorTasks(tasks);
  });

  it("rejects first-result observation when a deferred task stops before activation", async () => {
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

    await expect(task.firstResult).rejects.toThrow("stopped before its first valid result");
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
    const compileInput = vi.fn();
    const firstInput = vi.fn();
    const secondInput = vi.fn();
    const compile = createFakeTask("compile:component", "Compile", compileInput);
    const first = createFakeTask("test:first", "First", firstInput);
    const second = createFakeTask("preview:second", "Second", secondInput);
    compile.rawOutput.append("stdout", "compile buffered\n");
    first.rawOutput.append("stdout", "first buffered\n");
    second.rawOutput.append("stdout", "second buffered\n");
    const dispose = vi.fn(() => {
      expect(input.isRaw).toBe(false);
      expect(input.isPaused()).toBe(true);
      expect(output.text()).toContain("\x1b[?25h");
      return stopVendorTasks([compile, first, second]);
    });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

    try {
      setImmediate(() => {
        input.emit("keypress", "\r", { name: "return" });
        input.emit("keypress", undefined, { name: "escape" });
        input.emit("keypress", undefined, { name: "down" });
        input.emit("keypress", undefined, { name: "down" });
        input.emit("keypress", "\r", { name: "return" });
        input.emit("keypress", "x", { name: "x" });
        input.emit("keypress", undefined, { name: "escape" });
        input.emit("keypress", "q", { name: "q" });
        expect(dispose).not.toHaveBeenCalled();
        input.emit("keypress", undefined, { ctrl: true, name: "c" });
      });
      await superviseVendorTasks([compile, first, second], {
        title: "Combined",
        interactive: true,
        dispose,
        terminal: {
          stdin: input as unknown as ManagedTerminalInputStream,
          stdout: output as unknown as NodeJS.WriteStream,
          stderr: output as unknown as NodeJS.WriteStream,
        },
      });
    } finally {
      kill.mockRestore();
    }

    expect(compileInput).not.toHaveBeenCalled();
    expect(firstInput).not.toHaveBeenCalled();
    expect(secondInput).toHaveBeenCalledWith("x");
    expect(output.text()).toContain("compile buffered");
    expect(output.text()).toContain("second buffered");
    expect(dispose).toHaveBeenCalledOnce();
    expect(compile.stop).toHaveBeenCalledOnce();
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });

  it("delegates a non-interactive combined session to one disposer without duplicate task stops", async () => {
    const compile = createFakeTask("compile:component", "Compile", vi.fn());
    const preview = createFakeTask("preview:env", "Preview", vi.fn());
    const test = createFakeTask("test:env", "Test", vi.fn());
    const dispose = vi.fn(async () => {
      await Promise.all([compile.stop(), preview.stop(), test.stop()]);
    });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    setImmediate(() => process.emit("SIGTERM"));

    try {
      await superviseVendorTasks([compile, preview, test], {
        title: "Non-interactive combined",
        interactive: false,
        dispose,
      });
    } finally {
      kill.mockRestore();
    }

    expect(dispose).toHaveBeenCalledOnce();
    expect(compile.stop).toHaveBeenCalledOnce();
    expect(preview.stop).toHaveBeenCalledOnce();
    expect(test.stop).toHaveBeenCalledOnce();
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "detaches presentation listeners before delegating %s cleanup",
    async (signal) => {
      const events: string[] = [];
      const task = createFakeTask("test:signal", "Signal", vi.fn(), events);
      const dispose = vi.fn(async () => {
        events.push("dispose");
      });
      const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

      try {
        setImmediate(() => {
          process.emit(signal);
          process.emit(signal);
        });
        await superviseVendorTasks([task], {
          title: "Signal",
          interactive: false,
          dispose,
        });

        expect(events).toEqual(["unsubscribe-message", "unsubscribe-output", "dispose"]);
        expect(task.stop).not.toHaveBeenCalled();
        expect(dispose).toHaveBeenCalledOnce();
        expect(kill).toHaveBeenCalledTimes(1);
        expect(kill).toHaveBeenCalledWith(process.pid, signal);
      } finally {
        kill.mockRestore();
      }
    }
  );

  it("restores root state and preserves the signal after aggregate disposal rejects", async () => {
    const task = createFakeTask("test:cleanup-failure", "Cleanup failure", vi.fn());
    const failure = new Error("aggregate cleanup failed");
    const dispose = vi.fn(async () => {
      throw failure;
    });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");

    try {
      setImmediate(() => process.emit("SIGINT"));
      await expect(superviseVendorTasks([task], {
        title: "Cleanup failure",
        interactive: false,
        dispose,
      })).rejects.toBe(failure);

      expect(dispose).toHaveBeenCalledOnce();
      expect(task.stop).not.toHaveBeenCalled();
      expect(kill).toHaveBeenCalledWith(process.pid, "SIGINT");
      expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
    } finally {
      kill.mockRestore();
    }
  });

  it("forces a worker whose returned cleanup hook does not settle", async () => {
    const tasks = await createWatchVendorTasks(
      [createTaskOptions(createHungStopVendorUrl(), ["--watch"])],
      {
        serviceId: "test",
        label: "Hung",
        formatResult: () => [],
      }
    );
    const task = tasks[0]!;
    await task.firstResult;
    const startedAt = Date.now();

    await task.stop();

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(task.status).toBe("stopped");
  });

  it("shares repeated task stop and keeps private shutdown out of application messages", async () => {
    const tasks = await createWatchVendorTasks<JsonObject, { kind: string }>(
      [createTaskOptions(createObservedStopVendorUrl(), ["--watch"])],
      {
        serviceId: "test",
        label: "Observed",
        formatResult: () => [],
      }
    );
    const task = tasks[0]!;
    const statuses: string[] = [];
    task.onMessage?.((message) => {
      if (message.type === "status") statuses.push(message.status);
    });
    await task.firstResult;
    task.postMessage({ kind: "ping" });
    await vi.waitFor(() => expect(statuses).toContain("application:ping"));

    const firstStop = task.stop();
    const secondStop = task.stop();
    expect(secondStop).toBe(firstStop);
    await firstStop;

    expect(statuses).toContain("stop:1:applications:1");
  });

  it("continues collection cleanup and combines task stop failures", async () => {
    const first = createFakeTask("test:first-failure", "First failure", vi.fn());
    const second = createFakeTask("test:second-failure", "Second failure", vi.fn());
    first.stop.mockRejectedValue(new Error("first stop failed"));
    second.stop.mockRejectedValue(new Error("second stop failed"));

    const failure = await stopVendorTasks([first, second]).catch((error) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
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
    activate: vi.fn(async () => undefined),
    postMessage() {},
    writeInput,
    canAttach: true,
    stop: vi.fn(async () => {
      events.push("stop");
    }),
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
  #paused = true;

  isPaused() {
    return this.#paused;
  }

  pause() {
    this.#paused = true;
    return this;
  }

  resume() {
    this.#paused = false;
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

function createObservableVendorUrl() {
  const targetModule = toDataModule(`
    export default function start(runtime) {
      const result = (run) => ({
        mode: "watch",
        run,
        summary: "run " + run,
        componentIds: runtime.data.components.map((component) => component.id),
        observed: {},
      });
      runtime.postMessage({ type: "ready" });
      runtime.postMessage({ type: "result", data: result(1) });
      runtime.onMessage(() => {
        runtime.postMessage({ type: "result", data: result(2) });
      });
      return { stop() {} };
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "observable-fixture",
      label: "Observable Fixture",
      hint: "Observable fixture",
      moduleUrl: ${JSON.stringify(targetModule)}
    };
  `);
}

function createInvalidEventVendorUrl() {
  const targetModule = toDataModule(`
    export default function start(runtime) {
      runtime.postMessage({ type: "ready" });
      runtime.postMessage({ type: "result", data: { invalid: true } });
      runtime.postMessage({ type: "result", data: {
        mode: "watch",
        run: 2,
        summary: "must not publish",
        componentIds: [],
        observed: {},
      }});
      return { stop() {} };
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "invalid-event-fixture",
      label: "Invalid Event Fixture",
      hint: "Invalid event fixture",
      moduleUrl: ${JSON.stringify(targetModule)}
    };
  `);
}

function createFailingWatchVendorUrl() {
  const targetModule = toDataModule(`
    export default function start() {
      throw new Error("watch startup failed");
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "failing-watch-fixture",
      label: "Failing Watch Fixture",
      hint: "Failing watch fixture",
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

function createHungStopVendorUrl() {
  const targetModule = toDataModule(`
    export default function start(runtime) {
      runtime.postMessage({ type: "ready" });
      runtime.postMessage({ type: "result", data: { ok: true } });
      return { stop() { return new Promise(() => undefined); } };
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "hung-stop-fixture",
      label: "Hung Stop Fixture",
      hint: "Hung stop fixture",
      moduleUrl: ${JSON.stringify(targetModule)}
    };
  `);
}

function createObservedStopVendorUrl() {
  const targetModule = toDataModule(`
    export default function start(runtime) {
      let applications = 0;
      let stops = 0;
      runtime.onMessage((message) => {
        applications += 1;
        runtime.postMessage({ type: "status", status: "application:" + message.kind });
      });
      runtime.postMessage({ type: "ready" });
      runtime.postMessage({ type: "result", data: { ok: true } });
      return {
        async stop() {
          stops += 1;
          runtime.postMessage({
            type: "status",
            status: "stop:" + stops + ":applications:" + applications,
          });
          await new Promise((resolve) => setImmediate(resolve));
        }
      };
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "observed-stop-fixture",
      label: "Observed Stop Fixture",
      hint: "Observed stop fixture",
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

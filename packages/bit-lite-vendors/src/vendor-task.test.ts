import { isSelectedEnvIdentity, parseCliArguments } from "bit-lite-context";
import { RawOutputBuffer } from "bit-lite-terminal";
import { describe, expect, it, vi } from "vitest";
import { runVendorTasks, stopVendorTasks, watchVendorTasks } from "bit-lite-vendors";
import type { CliArguments, ComponentRef, SelectedEnvIdentity } from "bit-lite-context";
import type { JsonObject } from "./types/index.js";
import type { VendorTask, VendorTaskRunResult, VendorTaskStartOptions } from "bit-lite-vendors";

type TestServiceResult = {
  service: "test";
  env: SelectedEnvIdentity;
  vendor: string;
  mode: "run" | "watch";
  run: number;
  componentIds: string[];
  args: CliArguments;
  config: JsonObject;
  total: number;
  passed: number;
  failed: number;
  summary: string;
};

type MixedRunResult = {
  service: "mixed";
  phase: "complete";
  componentCount: number;
  summary: string;
};

type MixedEventResult = {
  service: "mixed";
  phase: "progress";
  env: SelectedEnvIdentity;
  componentCount: number;
  detail: string;
};

const testXVendorSpecifier = createTestVendorSpecifier({
  id: "test-x",
  label: "Test X",
  vendor: "x",
  multiplier: 2,
});
const testYVendorSpecifier = createTestVendorSpecifier({
  id: "test-y",
  label: "Test Y",
  vendor: "y",
  multiplier: 3,
});
const mixedResultsVendorSpecifier = createMixedResultsVendorSpecifier();

const fixtureGroups: Record<string, {
  components: ComponentRef[];
  services: Record<string, { vendor: string; config: Record<string, unknown> }>;
}> = {
  demo: {
    components: [{
      id: "components/demo/button",
      rootDir: "/workspace/components/demo/button",
      packageName: "@fixture/demo.button",
    }],
    services: {
      test: {
        vendor: testXVendorSpecifier,
        config: { label: "demo test", shard: "unit", retries: 1, coverage: true },
      },
    },
  },
  react: {
    components: [{
      id: "components/react/card",
      rootDir: "/workspace/components/react/card",
      packageName: "@fixture/react.card",
    }],
    services: {
      test: {
        vendor: testYVendorSpecifier,
        config: { label: "react test", shard: "browser", retries: 2, coverage: false },
      },
    },
  },
  mixed: {
    components: [{
      id: "components/demo/button",
      rootDir: "/workspace/components/demo/button",
      packageName: "@fixture/demo.button",
    }],
    services: { mixed: { vendor: mixedResultsVendorSpecifier, config: {} } },
  },
};

describe("vendor task helpers", () => {
  it("runs a test vendor once through the run helper", async () => {
    let printedResults: VendorTaskRunResult<TestServiceResult>[] | undefined;
    let printedTasks: VendorTask<TestServiceResult>[] | undefined;

    const results = await runVendorTasks<TestServiceResult>([createTaskOptions("demo", "test", [])], {
      serviceId: "test",
      label: "Test",
      formatResult: formatTestRunResult,
      printResults(resultsToPrint, tasks) {
        printedResults = resultsToPrint;
        printedTasks = tasks;
      },
    });

    expect(results).toMatchObject([
      {
        service: "test",
        env: selectedEnv("demo"),
        vendor: "test-x",
        data: {
          service: "test",
          env: selectedEnv("demo"),
          vendor: "x",
          mode: "run",
          componentIds: ["components/demo/button"],
          total: 2,
          passed: 2,
          failed: 0,
          summary: "2/2 passed",
          config: {
            shard: "unit",
            retries: 1,
            coverage: true,
          },
        },
      },
    ]);
    expect(printedResults).toBe(results);
    expect(printedTasks?.[0]?.label).toBe("Test X (demo)");
  });

  it("does not depend on result events in run once mode", async () => {
    const results = await runVendorTasks<MixedRunResult>([createTaskOptions("mixed", "mixed", [])], {
      serviceId: "mixed",
      label: "Mixed",
      formatResult: formatMixedRunResult,
      printResults() {},
    });

    expect(results).toEqual([
      {
        service: "mixed",
        env: selectedEnv("mixed"),
        vendor: "mixed-results",
        data: {
          service: "mixed",
          phase: "complete",
          componentCount: 1,
          summary: "run saw 1 component(s)",
        },
      },
    ]);
  });

  it("uses event result data for watch details", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    let receivedResult: MixedEventResult | undefined;

    try {
      const tasks = await watchVendorTasks<MixedEventResult>([createTaskOptions("mixed", "mixed", ["--watch"])], {
        serviceId: "mixed",
        label: "Mixed",
        title: "mixed watch",
        formatResult: formatMixedWatchResult,
        onResult(result) {
          receivedResult = result;
          process.emit("SIGTERM");
        },
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.details).toEqual(["event: event saw 1 component(s)"]);
      expect(tasks[0]?.canAttach).toBe(true);
      expect(receivedResult?.env).toEqual(selectedEnv("mixed"));
      expect(receivedResult).not.toHaveProperty("envName");
    } finally {
      kill.mockRestore();
    }
  });

  it("does not wait forever for hung task termination", async () => {
    const stop = vi.fn();
    const terminate = vi.fn(() => new Promise<void>(() => undefined));
    const task = {
      id: "hung:test",
      label: "Hung Test",
      status: "running",
      rawOutput: new RawOutputBuffer(),
      env: selectedEnv("hung"),
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

  it("rejects an env service config without a vendor", async () => {
    const taskOptions = createTaskOptions("demo", "test", []);

    await expect(
      runVendorTasks<TestServiceResult>(
        [
          {
            ...taskOptions,
            service: {
              ...taskOptions.service,
              definition: {
                config: { label: "missing vendor" },
              } as never,
            },
          },
        ],
        {
          serviceId: "test",
          label: "Test",
          formatResult: formatTestRunResult,
          printResults() {},
        }
      )
    ).rejects.toThrow('test service config for env "demo" must define a vendor');
  });
});

function createTaskOptions(fixtureName: string, serviceId: string, rawArgs: string[]): VendorTaskStartOptions {
  const group = fixtureGroups[fixtureName];
  if (!group) throw new Error(`Missing fixture group "${fixtureName}"`);
  const definition = group.services[serviceId];
  if (!definition) throw new Error(`Missing fixture service "${fixtureName}.${serviceId}"`);

  return {
    env: selectedEnv(fixtureName),
    components: group.components,
    args: parseCliArguments(rawArgs),
    workspaceRoot: "/workspace",
    service: {
      definition: definition as never,
      declaredBy: fixtureName,
      packageRoot: "/workspace",
      entryUrl: "file:///workspace/index.json",
      entryDirectory: "/workspace",
    },
    runtime: { workspaceRoot: "/workspace" },
  };
}

function createTestVendorSpecifier(options: {
  id: string;
  label: string;
  vendor: string;
  multiplier: number;
}) {
  const targetModule = toDataModule(`
    export default function start(runtime) {
      const componentIds = runtime.data.components.map((component) => component.id);
      const mode = runtime.data.args.options.watch === true ? "watch" : "run";
      const total = componentIds.length * ${JSON.stringify(options.multiplier)};
      const data = {
        service: "test",
        env: runtime.data.env,
        vendor: ${JSON.stringify(options.vendor)},
        mode,
        run: 1,
        componentIds,
        args: runtime.data.args,
        config: toJsonObject(runtime.data.config),
        total,
        passed: total,
        failed: 0,
        summary: total + "/" + total + " passed",
      };

      runtime.postMessage({ type: "ready" });

      if (mode === "watch") {
        runtime.postMessage({ type: "status", status: "watching" });
        runtime.postMessage({ type: "result", data });
        return {
          stop() {
            runtime.postMessage({ type: "status", status: "stopped" });
          },
        };
      }

      runtime.postMessage({ type: "status", status: "success" });
      return { data };
    }

    function toJsonObject(config) {
      return config && typeof config === "object" && !Array.isArray(config) ? config : {};
    }
  `);

  return toDataModule(`
    export const meta = {
      id: ${JSON.stringify(options.id)},
      label: ${JSON.stringify(options.label)},
      hint: ${JSON.stringify(`${options.label} fixture`)},
      moduleUrl: ${JSON.stringify(targetModule)}
    };
  `);
}

function createMixedResultsVendorSpecifier() {
  const targetModule = toDataModule(`
    export default async function start(runtime) {
      const componentCount = runtime.data.components.length;

      runtime.postMessage({ type: "ready" });
      runtime.postMessage({ type: "status", status: "running" });
      runtime.postMessage({
        type: "result",
        data: {
          service: "mixed",
          phase: "progress",
          env: runtime.data.env,
          componentCount,
          detail: "event saw " + componentCount + " component(s)",
        },
      });

      return {
        data: {
          service: "mixed",
          phase: "complete",
          componentCount,
          summary: "run saw " + componentCount + " component(s)",
        },
        stop() {
          runtime.postMessage({ type: "status", status: "stopped" });
        },
      };
    }
  `);

  return toDataModule(`
    export const meta = {
      id: "mixed-results",
      label: "Mixed Results",
      hint: "Mixed result fixture",
      moduleUrl: ${JSON.stringify(targetModule)}
    };
  `);
}

function toDataModule(source: string) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

function formatTestRunResult(result: unknown) {
  if (!isTestServiceResult(result)) return new Error("Invalid test run result");
  return result;
}

function isTestServiceResult(value: unknown): value is TestServiceResult {
  return (
    isRecord(value) &&
    value.service === "test" &&
    !("envName" in value) &&
    isSelectedEnvIdentity(value.env) &&
    typeof value.vendor === "string" &&
    (value.mode === "run" || value.mode === "watch") &&
    typeof value.run === "number" &&
    Array.isArray(value.componentIds) &&
    value.componentIds.every((componentId) => typeof componentId === "string") &&
    isRecord(value.args) &&
    isJsonObject(value.config) &&
    typeof value.total === "number" &&
    typeof value.passed === "number" &&
    typeof value.failed === "number" &&
    typeof value.summary === "string"
  );
}

function formatMixedRunResult(value: unknown): MixedRunResult | Error {
  return isMixedRunResult(value) ? value : new Error("Invalid mixed run result");
}

function formatMixedWatchResult(value: unknown) {
  if (!isMixedEventResult(value)) return new Error("Invalid mixed event result");
  return [`event: ${value.detail}`];
}

function isMixedRunResult(value: unknown): value is MixedRunResult {
  return (
    isRecord(value) &&
    value.service === "mixed" &&
    value.phase === "complete" &&
    typeof value.componentCount === "number" &&
    typeof value.summary === "string"
  );
}

function isMixedEventResult(value: unknown): value is MixedEventResult {
  return (
    isRecord(value) &&
    value.service === "mixed" &&
    value.phase === "progress" &&
    isSelectedEnvIdentity(value.env) &&
    typeof value.componentCount === "number" &&
    typeof value.detail === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonObject[keyof JsonObject] {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function selectedEnv(packageName: string): SelectedEnvIdentity {
  return {
    packageName,
    requestedVersion: "workspace:*",
    installedVersion: "0.0.0",
  };
}

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as vendorTasks from "bit-lite-vendors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../cli.js";
import { createResultStore } from "../result-store.js";
import { runTestCommand, type TestServiceResult } from "./test.js";
import type { VendorTask, VendorTaskStartOptions, WatchVendorTasksOptions } from "bit-lite-vendors";

describe("test command", () => {
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs configured test vendors once", async () => {
    const workspaceRoot = await createWorkspace();
    const code = await runCli(["test", "--workspace", workspaceRoot]);

    expect(code, JSON.stringify({ errors, logs }, null, 2)).toBe(0);
    expect(errors).toEqual([]);
    expect(logs).toEqual([
      "Test results:",
      "- Jest (jest): 2/2 passed",
      "  - components/jest/math: 2/2 passed (2 files)",
      "- Vitest (vitest): 2/2 passed",
      "  - components/vitest/math: 2/2 passed (2 files)",
    ]);
  });

  it("filters selected components before env grouping", async () => {
    const workspaceRoot = await createWorkspace();
    const code = await runCli(["test", "--workspace", workspaceRoot, "--filter", "components/vitest/*"]);

    expect(code, JSON.stringify({ errors, logs }, null, 2)).toBe(0);
    expect(logs).toEqual([
      "Test results:",
      "- Vitest (vitest): 2/2 passed",
      "  - components/vitest/math: 2/2 passed (2 files)",
    ]);
  });

  it("runs non-interactive watch with worker tasks", async () => {
    const workspaceRoot = await createWorkspace();
    const code = await runCli(["test", "--workspace", workspaceRoot, "--watch"]);

    expect(code, JSON.stringify({ errors, logs }, null, 2)).toBe(0);
    expect(errors).toEqual([]);
  });

  it("records watch results into an injected store", async () => {
    const workspaceRoot = await createWorkspace();
    const store = createResultStore<TestServiceResult>();
    const restoreTerminal = setInteractiveTerminal(true);
    const watchVendorTasks = vi.spyOn(vendorTasks, "watchVendorTasks").mockImplementation(async (taskOptions, options) => {
      const tasks: VendorTask<unknown, TestServiceResult>[] = [];

      for (const taskOption of taskOptions) {
        const result = createWatchResult(taskOption.envName);
        const task = {
          id: `${taskOption.envName}:${result.vendor}`,
          envName: taskOption.envName,
        } as VendorTask<unknown, TestServiceResult>;

        (options as WatchVendorTasksOptions<TestServiceResult>).onResult?.(result, task);
        tasks.push(task);
      }

      return tasks;
    });

    try {
      await runTestCommand(createParsedTestArgs(workspaceRoot, { watch: true }), {
        resultStore: store,
      });
    } finally {
      restoreTerminal();
    }

    const entries = store.entries().sort((left, right) => left.vendor.localeCompare(right.vendor));

    expect(watchVendorTasks).toHaveBeenCalledOnce();
    expect(entries).toMatchObject([
      {
        taskId: "jest:jest",
        envName: "jest",
        vendor: "jest",
        json: {
          service: "test",
          vendor: "jest",
          run: 1,
          stats: {
            summary: "2/2 passed",
          },
        },
        text: expect.stringMatching(
          /^# jest run 1 @ .+\njest: 2\/2 passed\ncomponents\/jest\/math: 2\/2 passed \(2 files\)$/
        ),
      },
      {
        taskId: "vitest:vitest",
        envName: "vitest",
        vendor: "vitest",
        json: {
          service: "test",
          vendor: "vitest",
          run: 1,
          stats: {
            summary: "2/2 passed",
          },
        },
        text: expect.stringMatching(
          /^# vitest run 1 @ .+\nvitest: 2\/2 passed\ncomponents\/vitest\/math: 2\/2 passed \(2 files\)$/
        ),
      },
    ]);
    expect(store.json("jest")).toHaveLength(1);
    expect(store.text("vitest")).toContain("# vitest run 1 @ ");
  });

  it("does not record run-once results into an injected store", async () => {
    const workspaceRoot = await createWorkspace();
    const store = createResultStore<TestServiceResult>();

    await runTestCommand(createParsedTestArgs(workspaceRoot), {
      resultStore: store,
    });

    expect(store.entries()).toEqual([]);
  });
});

function createParsedTestArgs(workspaceRoot: string, options: { watch?: boolean } = {}) {
  const raw = ["test", "--workspace", workspaceRoot, ...(options.watch === true ? ["--watch"] : [])];

  return {
    command: "test",
    args: {
      raw,
      positional: [],
      options: options.watch === true ? { watch: true } : {},
      passthrough: [],
    },
    workspaceRoot,
    componentFilters: [],
    help: false,
  };
}

function createWatchResult(envName: VendorTaskStartOptions["envName"]): TestServiceResult {
  const componentId = `components/${envName}/math`;

  return {
    service: "test",
    vendor: envName,
    mode: "watch",
    run: 1,
    context: {
      envName,
      componentIds: [componentId],
      args: {
        raw: ["test", "--watch"],
        positional: [],
        options: { watch: true },
        passthrough: [],
      },
      config: {},
    },
    stats: {
      total: 2,
      passed: 2,
      failed: 0,
      skipped: 0,
      summary: "2/2 passed",
    },
    componentResults: [
      {
        componentId,
        files: [`${componentId}/index.test.ts`, `${componentId}/arithmetic.spec.ts`],
        stats: {
          total: 2,
          passed: 2,
          failed: 0,
          skipped: 0,
          summary: "2/2 passed",
        },
        durationMs: 1,
        errors: [],
      },
    ],
  };
}

function setInteractiveTerminal(value: boolean) {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value,
  });

  return () => {
    restoreProperty(process.stdin, "isTTY", stdinDescriptor);
    restoreProperty(process.stdout, "isTTY", stdoutDescriptor);
  };
}

function restoreProperty(target: NodeJS.ReadStream | NodeJS.WriteStream, property: "isTTY", descriptor: PropertyDescriptor | undefined) {
  if (descriptor === undefined) {
    delete target[property];
    return;
  }

  Object.defineProperty(target, property, descriptor);
}

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-cli-"));
  await writeFile(
    path.join(workspaceRoot, "bit-lite.json"),
    JSON.stringify(
      {
        envs: {
          jest: {
            services: {
              test: {
                vendor: "demo-vendors/testers/jest",
                config: {
                  configFile: "demo-config/testers/jest/react",
                },
              },
            },
          },
          vitest: {
            services: {
              test: {
                vendor: "demo-vendors/testers/vitest",
                config: {
                  configFile: "demo-config/testers/vitest/node",
                },
              },
            },
          },
        },
        components: {
          "components/jest/**": "jest",
          "components/vitest/**": "vitest",
        },
      },
      null,
      2
    )
  );

  await writeMathComponent(workspaceRoot, "components/jest/math");
  await writeMathComponent(workspaceRoot, "components/vitest/math");

  return workspaceRoot;
}

async function writeMathComponent(workspaceRoot: string, componentDir: string) {
  const absoluteDir = path.join(workspaceRoot, componentDir);
  await mkdir(absoluteDir, { recursive: true });
  await writeFile(path.join(absoluteDir, "index.ts"), "export const add = (left: number, right: number) => left + right;\n");
  await writeFile(
    path.join(absoluteDir, "index.test.ts"),
    [
      'import assert from "node:assert/strict";',
      'import { add } from "./index.js";',
      "",
      'describe("add", () => {',
      '  it("adds two numbers", () => {',
      "    assert.equal(add(2, 3), 5);",
      "  });",
      "});",
      "",
    ].join("\n")
  );
  await writeFile(
    path.join(absoluteDir, "arithmetic.spec.ts"),
    [
      'import assert from "node:assert/strict";',
      'import { add } from "./index.js";',
      "",
      'describe("arithmetic", () => {',
      '  it("adds negative numbers", () => {',
      "    assert.equal(add(-2, -3), -5);",
      "  });",
      "});",
      "",
    ].join("\n")
  );
}

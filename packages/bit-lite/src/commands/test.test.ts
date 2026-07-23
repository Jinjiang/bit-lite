import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SelectedEnvIdentity } from "bit-lite-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../cli.js";
import { prepareResolvedCommandSelection } from "../utils/command-selection.js";
import {
  createTestWatchResultStore,
  createTestWatchContribution,
  isTestServiceResult,
  runTestCommand,
  type TestServiceResult,
} from "./test.js";
import type { JsonObject, VendorTaskStartOptions } from "bit-lite-vendors";

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
    const store = createTestWatchResultStore();
    const parsed = createParsedTestArgs(workspaceRoot, { watch: true, coverage: true });
    const selection = await prepareResolvedCommandSelection(parsed);
    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");
    const contribution = await createTestWatchContribution(selection, { resultStore: store });
    const taskStops = contribution.tasks.map((task) => vi.spyOn(task, "stop"));

    try {
      expect(contribution.tasks).toHaveLength(2);
      expect(contribution.bindings).toHaveLength(2);
      expect(contribution.effectiveArgs.options).toEqual({ watch: true, coverage: true });
      expect(contribution.effectiveArgs.raw).toEqual(parsed.args.raw);
      expect(contribution.effectiveArgs).not.toBe(parsed.args);
      expect(Object.isFrozen(contribution.effectiveArgs)).toBe(true);
      expect(Object.isFrozen(contribution.effectiveArgs.options)).toBe(true);
      expect(parsed.args.options).toEqual({ watch: true, coverage: true });
      expect(contribution.tasks.every((task) => task.context.workspace === selection.context.workspace)).toBe(true);
      expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
      await vi.waitFor(() => expect(store.entries()).toHaveLength(2), { timeout: 5_000 });
    } finally {
      const firstDispose = contribution.dispose();
      const concurrentDispose = contribution.dispose();
      expect(concurrentDispose).toBe(firstDispose);
      await firstDispose;
      expect(taskStops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
    }

    const entries = store.entries().sort((left, right) => left.vendor.localeCompare(right.vendor));

    expect(entries).toMatchObject([
      {
        taskId: 'test:["jest","1.0.0"]:jest',
        env: selectedEnv("jest"),
        vendor: "jest",
        json: {
          run: 1,
          stats: {
            summary: "2/2 passed",
          },
          coverage: { enabled: true },
        },
        text: expect.stringMatching(
          /^# jest run 1 @ .+\njest: 2\/2 passed\ncomponents\/jest\/math: 2\/2 passed \(2 files\)$/
        ),
      },
      {
        taskId: 'test:["vitest","1.0.0"]:vitest',
        env: selectedEnv("vitest"),
        vendor: "vitest",
        json: {
          run: 1,
          stats: {
            summary: "2/2 passed",
          },
          coverage: { enabled: true },
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
    const store = createTestWatchResultStore();

    await runTestCommand(createParsedTestArgs(workspaceRoot), {
      resultStore: store,
    });

    expect(store.entries()).toEqual([]);
  });

  it("accepts extensible JSON data without reserving historical field names", () => {
    const result = createWatchResult(selectedEnv("jest"));
    expect(isTestServiceResult({ ...result, coverage: { lines: 100 } })).toBe(true);
    expect(isTestServiceResult({
      ...result,
      env: selectedEnv("jest"),
      service: "test",
      config: {},
    })).toBe(true);
  });

  it("enables contribution watch mode without mutating or discarding arguments", async () => {
    const workspaceRoot = await createWorkspace();
    const parsed = createParsedTestArgs(workspaceRoot);
    parsed.command = "start";
    parsed.args = {
      raw: ["start", "--unknown", "value", "--", "fixture.ts"],
      options: { unknown: "value" },
      passthrough: ["fixture.ts"],
    };
    const selection = await prepareResolvedCommandSelection(parsed);

    const contribution = await createTestWatchContribution(selection);

    expect(contribution.effectiveArgs).toEqual({
      raw: parsed.args.raw,
      options: { unknown: "value", watch: true },
      passthrough: parsed.args.passthrough,
    });
    expect(contribution.effectiveArgs).not.toBe(parsed.args);
    expect(contribution.effectiveArgs.raw).not.toBe(parsed.args.raw);
    expect(contribution.effectiveArgs.passthrough).not.toBe(parsed.args.passthrough);
    expect(parsed.args.options).toEqual({ unknown: "value" });
    await contribution.dispose();
  });
});

function createParsedTestArgs(
  workspaceRoot: string,
  options: { watch?: boolean; coverage?: boolean } = {}
) {
  const raw = [
    "test",
    "--workspace",
    workspaceRoot,
    ...(options.watch === true ? ["--watch"] : []),
    ...(options.coverage === true ? ["--coverage"] : []),
  ];
  const parsedOptions: Record<string, boolean> = {};
  if (options.watch === true) parsedOptions.watch = true;
  if (options.coverage === true) parsedOptions.coverage = true;

  return {
    command: "test",
    args: {
      raw,
      options: parsedOptions,
      passthrough: [],
    },
    workspaceRoot,
    componentFilters: [],
    help: false,
  };
}

function createWatchResult(
  env: VendorTaskStartOptions["context"]["env"],
  coverage?: JsonObject
): TestServiceResult {
  const componentId = `components/${env.packageName}/math`;

  const result: TestServiceResult = {
    mode: "watch",
    run: 1,
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
  if (coverage !== undefined) result.coverage = coverage;
  return result;
}

function selectedEnv(packageName: string): SelectedEnvIdentity {
  return {
    packageName,
    requestedVersion: "1.0.0",
    installedVersion: "1.0.0",
  };
}

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-cli-"));
  await writeFile(
    path.join(workspaceRoot, "bit-lite.json"),
    JSON.stringify(
      {
        components: [
          {
            path: "components/jest/math",
            id: "components/jest/math",
            packageName: "@fixture/jest.math",
            env: { packageName: "jest", version: "1.0.0" },
          },
          {
            path: "components/vitest/math",
            id: "components/vitest/math",
            packageName: "@fixture/vitest.math",
            env: { packageName: "vitest", version: "1.0.0" },
          },
        ],
      },
      null,
      2
    )
  );

  await writeMathComponent(workspaceRoot, "components/jest/math");
  await writeMathComponent(workspaceRoot, "components/vitest/math");
  await installFixtureEnv(workspaceRoot, "@fixture/jest.math", "jest", "demo-vendors/testers/jest", "demo-config/testers/jest/react");
  await installFixtureEnv(workspaceRoot, "@fixture/vitest.math", "vitest", "demo-vendors/testers/vitest", "demo-config/testers/vitest/node");
  const workspaceNodeModules = path.join(workspaceRoot, "node_modules");
  await mkdir(workspaceNodeModules, { recursive: true });
  for (const packageName of ["demo-config", "demo-vendors"]) {
    await symlink(path.join(process.cwd(), "packages", packageName), path.join(workspaceNodeModules, packageName), "dir");
  }

  return workspaceRoot;
}

async function writeMathComponent(workspaceRoot: string, componentDir: string) {
  const absoluteDir = path.join(workspaceRoot, componentDir);
  await mkdir(absoluteDir, { recursive: true });
  await writeFile(path.join(absoluteDir, ".comp.json"), "{}\n");
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

async function installFixtureEnv(
  workspaceRoot: string,
  componentPackageName: string,
  envPackageName: string,
  vendor: string,
  configFile: string
) {
  const envRoot = path.join(workspaceRoot, ".fixture-envs", envPackageName);
  await mkdir(envRoot, { recursive: true });
  await writeFile(path.join(envRoot, "package.json"), JSON.stringify({
    name: envPackageName,
    version: "1.0.0",
    type: "module",
    exports: { ".": "./index.json" },
  }));
  await writeFile(path.join(envRoot, "index.json"), JSON.stringify({
    name: envPackageName,
    services: { test: { vendor, config: { configFile } } },
  }));
  const target = path.join(
    workspaceRoot,
    ".bit-lite/deps/components",
    ...componentPackageName.split("/"),
    "node_modules",
    envPackageName
  );
  await mkdir(path.dirname(target), { recursive: true });
  await symlink(path.relative(path.dirname(target), envRoot), target, "dir");
}

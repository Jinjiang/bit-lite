import path from "node:path";
import { startVitest } from "vitest/node";
import {
  createTimer,
  demoRoot,
  makeTestResult,
  relativePath,
  resolveRunOptions,
  withSuppressedOutput,
} from "../../shared/utils.js";
import type {
  ServiceRunOptions,
  TestCaseResult,
  TestFailure,
  TestServiceResult,
  TestStatus,
} from "../../types/service-results.js";

function mapVitestStatus(state: string, mode?: string): TestStatus {
  if (mode === "todo") {
    return "todo";
  }
  if (state === "passed" || state === "failed" || state === "skipped") {
    return state;
  }
  return "skipped";
}

function mapErrors(errors: readonly unknown[] | undefined): TestFailure[] | undefined {
  if (!errors?.length) {
    return undefined;
  }
  return errors.map((error) => {
    const value = error as { message?: string; stack?: string };
    return {
      message: value.message ?? String(error),
      stack: value.stack,
    };
  });
}

export async function runVitestTest(options?: ServiceRunOptions): Promise<TestServiceResult> {
  const run = resolveRunOptions(options, {
    targetFiles: [path.join(demoRoot, "targets/test/vitest/sample.test.ts")],
    configFile: path.join(demoRoot, "configs/vitest.config.ts"),
  });
  const elapsed = createTimer();
  const tests: TestCaseResult[] = [];
  const modules: unknown[] = [];
  const reporter = {
    onTestCaseResult(testCase: any) {
      const result = testCase.result();
      tests.push({
        name: testCase.fullName ?? testCase.name,
        status: mapVitestStatus(result.state, testCase.options?.mode),
        durationMs: testCase.diagnostic()?.duration,
        filePath: relativePath(testCase.module?.moduleId, run.cwd),
        failures: mapErrors(result.errors),
      });
    },
    onTestRunEnd(testModules: readonly unknown[]) {
      modules.push(...testModules);
    },
  };

  const { value: vitest } = await withSuppressedOutput(() =>
    startVitest("test", run.targetFiles, {
      root: run.cwd,
      config: run.configFile,
      run: true,
      watch: false,
      reporters: [reporter as any],
      passWithNoTests: false,
    }),
  );
  await withSuppressedOutput(() => vitest.close());

  const suites = modules.map((module: any) => ({
    name: module.relativeModuleId ?? module.moduleId ?? "vitest module",
    filePath: relativePath(module.moduleId, run.cwd),
    status: module.ok?.() ? "passed" as const : "failed" as const,
    durationMs: module.diagnostic?.().duration,
    tests: tests.filter((item) => item.filePath === relativePath(module.moduleId, run.cwd)),
  }));

  return makeTestResult({
    vendor: "vitest",
    apiKind: "js-api",
    ok: tests.every((item) => item.status !== "failed"),
    durationMs: elapsed(),
    targetFiles: run.targetFiles,
    suites,
    tests,
    baseDir: run.cwd,
    notes: [
      "Vitest exposes startVitest and reporter hooks; the same hook shape can stream watch-mode rerun events.",
    ],
  });
}


export default runVitestTest;

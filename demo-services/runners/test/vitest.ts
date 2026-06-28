import path from "node:path";
import { startVitest } from "vitest/node";
import {
  createTimer,
  demoRoot,
  isDirectRun,
  makeTestResult,
  printAndMaybeWriteResult,
  relativePath,
  withSuppressedOutput,
} from "../../src/shared/utils.js";
import type {
  TestCaseResult,
  TestFailure,
  TestServiceResult,
  TestStatus,
} from "../../src/types/service-results.js";

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

export async function runVitestTest(): Promise<TestServiceResult> {
  const target = path.join(demoRoot, "targets/test/vitest/sample.test.ts");
  const config = path.join(demoRoot, "configs/vitest.config.ts");
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
        filePath: relativePath(testCase.module?.moduleId),
        failures: mapErrors(result.errors),
      });
    },
    onTestRunEnd(testModules: readonly unknown[]) {
      modules.push(...testModules);
    },
  };

  const { value: vitest } = await withSuppressedOutput(() =>
    startVitest("test", [target], {
      root: demoRoot,
      config,
      run: true,
      watch: false,
      reporters: [reporter as any],
      passWithNoTests: false,
    }),
  );
  await withSuppressedOutput(() => vitest.close());

  const suites = modules.map((module: any) => ({
    name: module.relativeModuleId ?? module.moduleId ?? "vitest module",
    filePath: relativePath(module.moduleId),
    status: module.ok?.() ? "passed" as const : "failed" as const,
    durationMs: module.diagnostic?.().duration,
    tests: tests.filter((item) => item.filePath === relativePath(module.moduleId)),
  }));

  return makeTestResult({
    vendor: "vitest",
    apiKind: "js-api",
    ok: tests.every((item) => item.status !== "failed"),
    durationMs: elapsed(),
    targetFiles: [target],
    suites,
    tests,
    notes: [
      "Vitest exposes startVitest and reporter hooks; the same hook shape can stream watch-mode rerun events.",
    ],
  });
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runVitestTest());
  process.exitCode = 0;
}

import { runCLI } from "jest";
import path from "node:path";
import {
  createTimer,
  demoRoot,
  isDirectRun,
  makeTestResult,
  printAndMaybeWriteResult,
  relativePath,
  withSuppressedOutput,
} from "../../src/shared/utils.js";
import type { TestCaseResult, TestServiceResult, TestStatus } from "../../src/types/service-results.js";

function mapStatus(status: string): TestStatus {
  if (status === "passed" || status === "failed" || status === "skipped" || status === "todo") {
    return status;
  }
  return status === "pending" ? "skipped" : "failed";
}

export async function runJestTest(): Promise<TestServiceResult> {
  const target = path.join(demoRoot, "targets/test/jest/sample.test.cjs");
  const elapsed = createTimer();
  const { value } = await withSuppressedOutput(() =>
    runCLI(
      {
        rootDir: demoRoot,
        testMatch: [target],
        runInBand: true,
        silent: true,
        json: true,
        useStderr: true,
      } as any,
      [demoRoot],
    ),
  );
  const { results } = value;

  const suites = results.testResults.map((suite) => {
    const tests: TestCaseResult[] = suite.testResults.map((test) => ({
      name: test.fullName,
      status: mapStatus(test.status),
      durationMs: test.duration ?? undefined,
      filePath: relativePath(suite.testFilePath),
      failures: test.failureMessages.length
        ? test.failureMessages.map((message) => ({ message }))
        : undefined,
    }));
    return {
      name: relativePath(suite.testFilePath) ?? suite.testFilePath,
      filePath: relativePath(suite.testFilePath),
      status: suite.numFailingTests > 0 ? "failed" as const : "passed" as const,
      durationMs: suite.perfStats.runtime,
      tests,
    };
  });
  const tests = suites.flatMap((suite) => suite.tests);

  return makeTestResult({
    vendor: "jest",
    apiKind: "js-api",
    ok: results.success,
    durationMs: elapsed(),
    targetFiles: [target],
    suites,
    tests,
    notes: [
      "Jest exposes runCLI for one-shot structured results. Watch mode is better modeled with a custom reporter because the watch process stays alive.",
    ],
    raw: results,
  });
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runJestTest());
  process.exitCode = 0;
}

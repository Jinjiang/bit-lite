import { runCLI } from "jest";
import {
  createTimer,
  makeTestResult,
  relativePath,
  resolveRunOptions,
  withSuppressedOutput,
} from "../../shared/utils.js";
import type { ServiceRunOptions, TestCaseResult, TestServiceResult, TestStatus } from "../../types/service-results.js";

function mapStatus(status: string): TestStatus {
  if (status === "passed" || status === "failed" || status === "skipped" || status === "todo") {
    return status;
  }
  return status === "pending" ? "skipped" : "failed";
}

export async function runJestTest(options: ServiceRunOptions): Promise<TestServiceResult> {
  const run = resolveRunOptions(options);
  const elapsed = createTimer();
  const { value } = await withSuppressedOutput(() =>
    runCLI(
      {
        rootDir: run.cwd,
        testMatch: run.targetFiles,
        runInBand: true,
        silent: true,
        json: true,
        useStderr: true,
      } as any,
      [run.cwd],
    ),
  );
  const { results } = value;

  const suites = results.testResults.map((suite) => {
    const tests: TestCaseResult[] = suite.testResults.map((test) => ({
      name: test.fullName,
      status: mapStatus(test.status),
      durationMs: test.duration ?? undefined,
      filePath: relativePath(suite.testFilePath, run.cwd),
      failures: test.failureMessages.length
        ? test.failureMessages.map((message) => ({ message }))
        : undefined,
    }));
    return {
      name: relativePath(suite.testFilePath, run.cwd) ?? suite.testFilePath,
      filePath: relativePath(suite.testFilePath, run.cwd),
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
    targetFiles: run.targetFiles,
    suites,
    tests,
    baseDir: run.cwd,
    notes: [
      "Jest exposes runCLI for one-shot structured results. Watch mode is better modeled with a custom reporter because the watch process stays alive.",
    ],
    raw: results,
  });
}


export default runJestTest;

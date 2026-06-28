import Mocha from "mocha";
import {
  createTimer,
  makeTestResult,
  relativePath,
  resolveRunOptions,
  withSuppressedOutput,
} from "../../shared/utils.js";
import type { ServiceRunOptions, TestCaseResult, TestServiceResult } from "../../types/service-results.js";

export async function runMochaTest(options: ServiceRunOptions): Promise<TestServiceResult> {
  const run = resolveRunOptions(options);
  const elapsed = createTimer();
  const mocha = new Mocha({
    color: false,
    reporter: "dot",
  });
  for (const target of run.targetFiles) {
    mocha.addFile(target);
  }
  await mocha.loadFilesAsync();

  const tests: TestCaseResult[] = [];
  const { value: failures } = await withSuppressedOutput(() => new Promise<number>((resolve) => {
    const runner = mocha.run((failureCount) => resolve(failureCount));
    runner.on("pass", (test) => {
      tests.push({
        name: test.fullTitle(),
        status: "passed",
        durationMs: test.duration,
        filePath: relativePath(test.file, run.cwd),
      });
    });
    runner.on("fail", (test, error) => {
      tests.push({
        name: test.fullTitle(),
        status: "failed",
        durationMs: test.duration,
        filePath: relativePath(test.file, run.cwd),
        failures: [
          {
            message: error.message,
            stack: error.stack,
          },
        ],
      });
    });
    runner.on("pending", (test) => {
      tests.push({
        name: test.fullTitle(),
        status: "skipped",
        filePath: relativePath(test.file, run.cwd),
      });
    });
  }));

  const suite = {
    name: "mocha arithmetic",
    filePath: run.targetFiles.length === 1 ? relativePath(run.targetFiles[0], run.cwd) : undefined,
    status: failures > 0 ? "failed" as const : "passed" as const,
    tests,
  };

  return makeTestResult({
    vendor: "mocha",
    apiKind: "js-api",
    ok: failures === 0,
    durationMs: elapsed(),
    targetFiles: run.targetFiles,
    suites: [suite],
    tests,
    baseDir: run.cwd,
    notes: [
      "Mocha's programmatic Runner emits test events. For watch mode, this demo would own the watcher and rerun the same programmatic runner.",
    ],
  });
}


export default runMochaTest;

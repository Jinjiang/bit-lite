import Mocha from "mocha";
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
import type { TestCaseResult, TestServiceResult } from "../../src/types/service-results.js";

export async function runMochaTest(): Promise<TestServiceResult> {
  const target = path.join(demoRoot, "targets/test/mocha/sample.test.mjs");
  const elapsed = createTimer();
  const mocha = new Mocha({
    color: false,
    reporter: "dot",
  });
  mocha.addFile(target);
  await mocha.loadFilesAsync();

  const tests: TestCaseResult[] = [];
  const { value: failures } = await withSuppressedOutput(() => new Promise<number>((resolve) => {
    const runner = mocha.run((failureCount) => resolve(failureCount));
    runner.on("pass", (test) => {
      tests.push({
        name: test.fullTitle(),
        status: "passed",
        durationMs: test.duration,
        filePath: relativePath(test.file),
      });
    });
    runner.on("fail", (test, error) => {
      tests.push({
        name: test.fullTitle(),
        status: "failed",
        durationMs: test.duration,
        filePath: relativePath(test.file),
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
        filePath: relativePath(test.file),
      });
    });
  }));

  const suite = {
    name: "mocha arithmetic",
    filePath: relativePath(target),
    status: failures > 0 ? "failed" as const : "passed" as const,
    tests,
  };

  return makeTestResult({
    vendor: "mocha",
    apiKind: "js-api",
    ok: failures === 0,
    durationMs: elapsed(),
    targetFiles: [target],
    suites: [suite],
    tests,
    notes: [
      "Mocha's programmatic Runner emits test events. For watch mode, this demo would own the watcher and rerun the same programmatic runner.",
    ],
  });
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runMochaTest());
  process.exitCode = 0;
}

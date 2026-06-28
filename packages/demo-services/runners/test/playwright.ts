import path from "node:path";
import {
  createTimer,
  demoRoot,
  isDirectRun,
  makeTestResult,
  packagePath,
  parseJsonOutput,
  printAndMaybeWriteResult,
  relativePath,
  runCommand,
} from "../../src/shared/utils.js";
import type { TestCaseResult, TestServiceResult, TestStatus } from "../../src/types/service-results.js";

function mapPlaywrightStatus(status: string | undefined): TestStatus {
  if (status === "passed" || status === "failed" || status === "skipped") {
    return status;
  }
  if (status === "timedOut" || status === "interrupted") {
    return "failed";
  }
  return "skipped";
}

function collectSuite(suite: any, inheritedFile?: string): TestServiceResult["suites"] {
  const rawFilePath = suite.file ?? inheritedFile;
  const filePath =
    rawFilePath && path.isAbsolute(rawFilePath)
      ? rawFilePath
      : rawFilePath
        ? path.join(demoRoot, "targets/test/playwright", rawFilePath)
        : undefined;
  const childSuites = (suite.suites ?? []).flatMap((child: any) => collectSuite(child, filePath));
  const tests: TestCaseResult[] = (suite.specs ?? []).flatMap((spec: any) =>
    (spec.tests ?? []).map((test: any) => {
      const result = test.results?.[0] ?? {};
      return {
        name: [...(spec.titlePath ?? []), spec.title].filter(Boolean).join(" > "),
        status: mapPlaywrightStatus(result.status ?? test.outcome),
        durationMs: result.duration,
        filePath: relativePath(filePath),
        failures: result.error
          ? [
              {
                message: result.error.message ?? "Playwright test failure",
                stack: result.error.stack,
              },
            ]
          : undefined,
      };
    }),
  );
  const current = tests.length
    ? [
        {
          name: suite.title || relativePath(filePath) || "playwright suite",
          filePath: relativePath(filePath),
          status: tests.some((test) => test.status === "failed") ? "failed" : "passed",
          tests,
        },
      ]
    : [];
  return [...current, ...childSuites];
}

export async function runPlaywrightTest(): Promise<TestServiceResult> {
  const target = path.join(demoRoot, "targets/test/playwright/sample.spec.ts");
  const config = path.join(demoRoot, "configs/playwright.config.ts");
  const elapsed = createTimer();
  const playwrightBin = packagePath("@playwright/test", "cli.js");
  const command = await runCommand(process.execPath, [
    playwrightBin,
    "test",
    target,
    `--config=${config}`,
    "--reporter=json",
  ]);
  const raw = command.stdout.trim() ? parseJsonOutput(command.stdout) : undefined;
  const rootSuites = (raw as { suites?: unknown[] } | undefined)?.suites ?? [];
  const suites = rootSuites.flatMap((suite) => collectSuite(suite));
  const tests = suites.flatMap((suite) => suite.tests);

  return makeTestResult({
    vendor: "playwright",
    apiKind: "cli-json",
    ok: command.exitCode === 0 && tests.every((item) => item.status !== "failed"),
    durationMs: elapsed(),
    targetFiles: [target],
    suites,
    tests,
    notes: [
      "Playwright Test has a strong reporter API, but public test execution is CLI-first. This demo uses its JSON reporter instead of parsing human output.",
      "Watch or UI mode should stream through a custom reporter rather than waiting for a final CLI process exit.",
    ],
    raw: raw ?? { stderr: command.stderr, exitCode: command.exitCode },
  });
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runPlaywrightTest());
  process.exitCode = 0;
}

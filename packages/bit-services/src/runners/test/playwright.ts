import path from "node:path";
import {
  createTimer,
  demoRoot,
  makeTestResult,
  packagePath,
  parseJsonOutput,
  relativePath,
  resolveRunOptions,
  runCommand,
} from "../../shared/utils.js";
import type { ServiceRunOptions, TestCaseResult, TestServiceResult, TestStatus } from "../../types/service-results.js";

function mapPlaywrightStatus(status: string | undefined): TestStatus {
  if (status === "passed" || status === "failed" || status === "skipped") {
    return status;
  }
  if (status === "timedOut" || status === "interrupted") {
    return "failed";
  }
  return "skipped";
}

function collectSuite(suite: any, baseDir: string, inheritedFile?: string): TestServiceResult["suites"] {
  const rawFilePath = suite.file ?? inheritedFile;
  const filePath =
    rawFilePath && path.isAbsolute(rawFilePath)
      ? rawFilePath
      : rawFilePath
        ? path.join(baseDir, rawFilePath)
        : undefined;
  const childSuites = (suite.suites ?? []).flatMap((child: any) => collectSuite(child, baseDir, filePath));
  const tests: TestCaseResult[] = (suite.specs ?? []).flatMap((spec: any) =>
    (spec.tests ?? []).map((test: any) => {
      const result = test.results?.[0] ?? {};
      return {
        name: [...(spec.titlePath ?? []), spec.title].filter(Boolean).join(" > "),
        status: mapPlaywrightStatus(result.status ?? test.outcome),
        durationMs: result.duration,
        filePath: relativePath(filePath, baseDir),
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
          name: suite.title || relativePath(filePath, baseDir) || "playwright suite",
          filePath: relativePath(filePath, baseDir),
          status: tests.some((test) => test.status === "failed") ? "failed" : "passed",
          tests,
        },
      ]
    : [];
  return [...current, ...childSuites];
}

export async function runPlaywrightTest(options?: ServiceRunOptions): Promise<TestServiceResult> {
  const run = resolveRunOptions(options, {
    targetFiles: [path.join(demoRoot, "targets/test/playwright/sample.spec.ts")],
    configFile: path.join(demoRoot, "configs/playwright.config.ts"),
  });
  const elapsed = createTimer();
  const playwrightBin = packagePath("@playwright/test", "cli.js");
  const command = await runCommand(process.execPath, [
    playwrightBin,
    "test",
    ...run.targetFiles,
    ...(run.configFile ? [`--config=${run.configFile}`] : []),
    "--reporter=json",
  ], { cwd: run.cwd, env: run.env });
  const raw = command.stdout.trim() ? parseJsonOutput(command.stdout) : undefined;
  const rootSuites = (raw as { suites?: unknown[] } | undefined)?.suites ?? [];
  const suites = rootSuites.flatMap((suite) => collectSuite(suite, run.cwd));
  const tests = suites.flatMap((suite) => suite.tests);

  return makeTestResult({
    vendor: "playwright",
    apiKind: "cli-json",
    ok: command.exitCode === 0 && tests.every((item) => item.status !== "failed"),
    durationMs: elapsed(),
    targetFiles: run.targetFiles,
    suites,
    tests,
    baseDir: run.cwd,
    notes: [
      "Playwright Test has a strong reporter API, but public test execution is CLI-first. This demo uses its JSON reporter instead of parsing human output.",
      "Watch or UI mode should stream through a custom reporter rather than waiting for a final CLI process exit.",
    ],
    raw: raw ?? { stderr: command.stderr, exitCode: command.exitCode },
  });
}


export default runPlaywrightTest;

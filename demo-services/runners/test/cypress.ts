import cypress from "cypress";
import path from "node:path";
import {
  createTimer,
  demoRoot,
  errorDiagnostic,
  isDirectRun,
  makeTestResult,
  printAndMaybeWriteResult,
  relativePath,
  withSuppressedOutput,
} from "../../src/shared/utils.js";
import type { TestCaseResult, TestServiceResult, TestStatus } from "../../src/types/service-results.js";

function mapCypressStatus(state: string | undefined): TestStatus {
  if (state === "passed") {
    return "passed";
  }
  if (state === "pending" || state === "skipped") {
    return "skipped";
  }
  return "failed";
}

export async function runCypressTest(): Promise<TestServiceResult> {
  const target = path.join(demoRoot, "targets/test/cypress/e2e/sample.cy.ts");
  const project = path.join(demoRoot, "targets/test/cypress");
  const reporter = path.join(demoRoot, "configs/cypress-silent-reporter.cjs");
  const elapsed = createTimer();

  try {
    const { value: result } = await withSuppressedOutput(() =>
      cypress.run({
        project,
        spec: target,
        quiet: true,
        browser: "electron",
        reporter,
        config: {
          allowCypressEnv: false,
        },
      }),
    );
    const rawRuns = "runs" in result ? result.runs : [];
    const suites = rawRuns.map((run: any) => {
      const tests: TestCaseResult[] = (run.tests ?? []).map((test: any) => {
        const attempt = test.attempts?.[test.attempts.length - 1] ?? {};
        return {
          name: (test.title ?? []).join(" > "),
          status: mapCypressStatus(test.state),
          durationMs: attempt.duration,
          filePath: relativePath(run.spec?.absolute),
          failures: test.displayError
            ? [
                {
                  message: test.displayError,
                },
              ]
            : undefined,
        };
      });
      return {
        name: run.spec?.relative ?? "cypress spec",
        filePath: relativePath(run.spec?.absolute),
        status: tests.some((test) => test.status === "failed") ? "failed" as const : "passed" as const,
        durationMs: run.stats?.duration,
        tests,
      };
    });
    const tests = suites.flatMap((suite) => suite.tests);
    return makeTestResult({
      vendor: "cypress",
      apiKind: "module-api",
      ok: !("failures" in result && result.failures && result.failures > 0),
      durationMs: elapsed(),
      targetFiles: [target],
      suites,
      tests,
      notes: [
        "Cypress exposes cypress.run() for structured module results. cypress.open() is interactive and not a good service result source.",
      ],
      raw: result,
    });
  } catch (error) {
    const diagnostic = errorDiagnostic(error, "cypress");
    return makeTestResult({
      vendor: "cypress",
      apiKind: "module-api",
      ok: false,
      durationMs: elapsed(),
      targetFiles: [target],
      suites: [],
      tests: [],
      notes: [
        "Cypress module API was invoked, but local execution may require the Cypress binary to be installed in its cache.",
        diagnostic.message,
      ],
      raw: {
        error: diagnostic,
      },
    });
  }
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runCypressTest());
  process.exitCode = 0;
}

import cypress from "cypress";
import path from "node:path";
import {
  createTimer,
  demoRoot,
  errorDiagnostic,
  makeTestResult,
  relativePath,
  resolveRunOptions,
  withSuppressedOutput,
} from "../../shared/utils.js";
import type { ServiceRunOptions, TestCaseResult, TestServiceResult, TestStatus } from "../../types/service-results.js";

function mapCypressStatus(state: string | undefined): TestStatus {
  if (state === "passed") {
    return "passed";
  }
  if (state === "pending" || state === "skipped") {
    return "skipped";
  }
  return "failed";
}

export async function runCypressTest(options?: ServiceRunOptions): Promise<TestServiceResult> {
  const run = resolveRunOptions(options, {
    targetFiles: [path.join(demoRoot, "targets/test/cypress/e2e/sample.cy.ts")],
    projectDir: path.join(demoRoot, "targets/test/cypress"),
    configFile: path.join(demoRoot, "configs/cypress-silent-reporter.cjs"),
  });
  const elapsed = createTimer();

  try {
    const { value: result } = await withSuppressedOutput(() =>
      cypress.run({
        project: run.projectDir,
        spec: run.targetFiles.join(","),
        quiet: true,
        browser: "electron",
        reporter: run.configFile,
        config: {
          allowCypressEnv: false,
        },
      }),
    );
    const rawRuns = "runs" in result ? result.runs : [];
    const suites = rawRuns.map((cypressRun: any) => {
      const tests: TestCaseResult[] = (cypressRun.tests ?? []).map((test: any) => {
        const attempt = test.attempts?.[test.attempts.length - 1] ?? {};
        return {
          name: (test.title ?? []).join(" > "),
          status: mapCypressStatus(test.state),
          durationMs: attempt.duration,
          filePath: relativePath(cypressRun.spec?.absolute, run.cwd),
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
        name: cypressRun.spec?.relative ?? "cypress spec",
        filePath: relativePath(cypressRun.spec?.absolute, run.cwd),
        status: tests.some((test) => test.status === "failed") ? "failed" as const : "passed" as const,
        durationMs: cypressRun.stats?.duration,
        tests,
      };
    });
    const tests = suites.flatMap((suite) => suite.tests);
    return makeTestResult({
      vendor: "cypress",
      apiKind: "module-api",
      ok: !("failures" in result && result.failures && result.failures > 0),
      durationMs: elapsed(),
      targetFiles: run.targetFiles,
      suites,
      tests,
      baseDir: run.cwd,
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
      targetFiles: run.targetFiles,
      suites: [],
      tests: [],
      baseDir: run.cwd,
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


export default runCypressTest;

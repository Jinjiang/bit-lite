import runCypressTest from "../../src/runners/test/cypress.js";
import runJestTest from "../../src/runners/test/jest.js";
import runMochaTest from "../../src/runners/test/mocha.js";
import runPlaywrightTest from "../../src/runners/test/playwright.js";
import runVitestTest from "../../src/runners/test/vitest.js";
import { demoRuns, printAndMaybeWriteResult } from "./demo-options.js";

const results = [
  await runVitestTest(demoRuns["test:vitest"]),
  await runPlaywrightTest(demoRuns["test:playwright"]),
  await runCypressTest(demoRuns["test:cypress"]),
  await runJestTest(demoRuns["test:jest"]),
  await runMochaTest(demoRuns["test:mocha"]),
];

await printAndMaybeWriteResult(results, "test.json");
process.exitCode = 0;

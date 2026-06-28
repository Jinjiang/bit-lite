import runCypressTest from "../../src/runners/test/cypress.js";
import runJestTest from "../../src/runners/test/jest.js";
import runMochaTest from "../../src/runners/test/mocha.js";
import runPlaywrightTest from "../../src/runners/test/playwright.js";
import runVitestTest from "../../src/runners/test/vitest.js";
import { printAndMaybeWriteResult } from "../../src/shared/utils.js";

const results = [
  await runVitestTest(),
  await runPlaywrightTest(),
  await runCypressTest(),
  await runJestTest(),
  await runMochaTest(),
];

await printAndMaybeWriteResult(results, "test.json");
process.exitCode = 0;

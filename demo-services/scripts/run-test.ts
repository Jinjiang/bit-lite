import { runCypressTest } from "../runners/test/cypress.js";
import { runJestTest } from "../runners/test/jest.js";
import { runMochaTest } from "../runners/test/mocha.js";
import { runPlaywrightTest } from "../runners/test/playwright.js";
import { runVitestTest } from "../runners/test/vitest.js";
import { printAndMaybeWriteResult } from "../src/shared/utils.js";

const results = [
  await runVitestTest(),
  await runPlaywrightTest(),
  await runCypressTest(),
  await runJestTest(),
  await runMochaTest(),
];

await printAndMaybeWriteResult(results, "test.json");
process.exitCode = 0;

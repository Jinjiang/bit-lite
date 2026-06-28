import runBabelCompile from "../../src/runners/compile/babel.js";
import runEsbuildCompile from "../../src/runners/compile/esbuild.js";
import runOxcCompile from "../../src/runners/compile/oxc.js";
import runRollupCompile from "../../src/runners/compile/rollup.js";
import runSwcCompile from "../../src/runners/compile/swc.js";
import runTypeScriptCompile from "../../src/runners/compile/typescript.js";
import runViteCompile from "../../src/runners/compile/vite.js";
import runVueSfcCompile from "../../src/runners/compile/vue-sfc.js";
import runWebpackCompile from "../../src/runners/compile/webpack.js";
import runBiomeLint from "../../src/runners/lint/biome.js";
import runEslintLint from "../../src/runners/lint/eslint.js";
import runOxlintLint from "../../src/runners/lint/oxlint.js";
import runCypressTest from "../../src/runners/test/cypress.js";
import runJestTest from "../../src/runners/test/jest.js";
import runMochaTest from "../../src/runners/test/mocha.js";
import runPlaywrightTest from "../../src/runners/test/playwright.js";
import runVitestTest from "../../src/runners/test/vitest.js";
import { demoRuns, printAndMaybeWriteResult } from "./demo-options.js";

const runners = {
  "compile:babel": runBabelCompile,
  "compile:esbuild": runEsbuildCompile,
  "compile:oxc": runOxcCompile,
  "compile:rollup": runRollupCompile,
  "compile:swc": runSwcCompile,
  "compile:typescript": runTypeScriptCompile,
  "compile:vite": runViteCompile,
  "compile:vue-sfc": runVueSfcCompile,
  "compile:webpack": runWebpackCompile,
  "lint:biome": runBiomeLint,
  "lint:eslint": runEslintLint,
  "lint:oxlint": runOxlintLint,
  "test:cypress": runCypressTest,
  "test:jest": runJestTest,
  "test:mocha": runMochaTest,
  "test:playwright": runPlaywrightTest,
  "test:vitest": runVitestTest,
} as const;

const runnerName = process.argv[2] as keyof typeof runners | undefined;
const runner = runnerName ? runners[runnerName] : undefined;

if (!runner || !runnerName) {
  console.error(`Unknown demo runner: ${runnerName ?? "<missing>"}`);
  process.exitCode = 1;
} else {
  await printAndMaybeWriteResult(await runner(demoRuns[runnerName]));
}

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
import { printAndMaybeWriteResult } from "../../src/shared/utils.js";

const results = [
  await runEslintLint(),
  await runOxlintLint(),
  await runBiomeLint(),
  await runVitestTest(),
  await runPlaywrightTest(),
  await runCypressTest(),
  await runJestTest(),
  await runMochaTest(),
  await runTypeScriptCompile(),
  await runEsbuildCompile(),
  await runSwcCompile(),
  await runBabelCompile(),
  await runVueSfcCompile(),
  await runViteCompile(),
  await runRollupCompile(),
  await runWebpackCompile(),
  await runOxcCompile(),
];

await printAndMaybeWriteResult(results, "all.json");
process.exitCode = 0;

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

const results = [
  await runEslintLint(demoRuns["lint:eslint"]),
  await runOxlintLint(demoRuns["lint:oxlint"]),
  await runBiomeLint(demoRuns["lint:biome"]),
  await runVitestTest(demoRuns["test:vitest"]),
  await runPlaywrightTest(demoRuns["test:playwright"]),
  await runCypressTest(demoRuns["test:cypress"]),
  await runJestTest(demoRuns["test:jest"]),
  await runMochaTest(demoRuns["test:mocha"]),
  await runTypeScriptCompile(demoRuns["compile:typescript"]),
  await runEsbuildCompile(demoRuns["compile:esbuild"]),
  await runSwcCompile(demoRuns["compile:swc"]),
  await runBabelCompile(demoRuns["compile:babel"]),
  await runVueSfcCompile(demoRuns["compile:vue-sfc"]),
  await runViteCompile(demoRuns["compile:vite"]),
  await runRollupCompile(demoRuns["compile:rollup"]),
  await runWebpackCompile(demoRuns["compile:webpack"]),
  await runOxcCompile(demoRuns["compile:oxc"]),
];

await printAndMaybeWriteResult(results, "all.json");
process.exitCode = 0;

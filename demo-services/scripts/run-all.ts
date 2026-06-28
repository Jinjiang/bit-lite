import { runBabelCompile } from "../runners/compile/babel.js";
import { runEsbuildCompile } from "../runners/compile/esbuild.js";
import { runOxcCompile } from "../runners/compile/oxc.js";
import { runRollupCompile } from "../runners/compile/rollup.js";
import { runSwcCompile } from "../runners/compile/swc.js";
import { runTypeScriptCompile } from "../runners/compile/typescript.js";
import { runViteCompile } from "../runners/compile/vite.js";
import { runVueSfcCompile } from "../runners/compile/vue-sfc.js";
import { runWebpackCompile } from "../runners/compile/webpack.js";
import { runBiomeLint } from "../runners/lint/biome.js";
import { runEslintLint } from "../runners/lint/eslint.js";
import { runOxlintLint } from "../runners/lint/oxlint.js";
import { runCypressTest } from "../runners/test/cypress.js";
import { runJestTest } from "../runners/test/jest.js";
import { runMochaTest } from "../runners/test/mocha.js";
import { runPlaywrightTest } from "../runners/test/playwright.js";
import { runVitestTest } from "../runners/test/vitest.js";
import { printAndMaybeWriteResult } from "../src/shared/utils.js";

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

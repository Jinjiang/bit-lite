import runBabelCompile from "../../src/runners/compile/babel.js";
import runEsbuildCompile from "../../src/runners/compile/esbuild.js";
import runOxcCompile from "../../src/runners/compile/oxc.js";
import runRollupCompile from "../../src/runners/compile/rollup.js";
import runSwcCompile from "../../src/runners/compile/swc.js";
import runTypeScriptCompile from "../../src/runners/compile/typescript.js";
import runViteCompile from "../../src/runners/compile/vite.js";
import runVueSfcCompile from "../../src/runners/compile/vue-sfc.js";
import runWebpackCompile from "../../src/runners/compile/webpack.js";
import { printAndMaybeWriteResult } from "../../src/shared/utils.js";

const results = [
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

await printAndMaybeWriteResult(results, "compile.json");
process.exitCode = 0;

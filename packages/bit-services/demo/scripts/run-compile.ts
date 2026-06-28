import runBabelCompile from "../../src/runners/compile/babel.js";
import runEsbuildCompile from "../../src/runners/compile/esbuild.js";
import runOxcCompile from "../../src/runners/compile/oxc.js";
import runRollupCompile from "../../src/runners/compile/rollup.js";
import runSwcCompile from "../../src/runners/compile/swc.js";
import runTypeScriptCompile from "../../src/runners/compile/typescript.js";
import runViteCompile from "../../src/runners/compile/vite.js";
import runVueSfcCompile from "../../src/runners/compile/vue-sfc.js";
import runWebpackCompile from "../../src/runners/compile/webpack.js";
import { demoRuns, printAndMaybeWriteResult } from "./demo-options.js";

const results = [
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

await printAndMaybeWriteResult(results, "compile.json");
process.exitCode = 0;

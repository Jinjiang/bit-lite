import { runBabelCompile } from "../runners/compile/babel.js";
import { runEsbuildCompile } from "../runners/compile/esbuild.js";
import { runOxcCompile } from "../runners/compile/oxc.js";
import { runRollupCompile } from "../runners/compile/rollup.js";
import { runSwcCompile } from "../runners/compile/swc.js";
import { runTypeScriptCompile } from "../runners/compile/typescript.js";
import { runViteCompile } from "../runners/compile/vite.js";
import { runVueSfcCompile } from "../runners/compile/vue-sfc.js";
import { runWebpackCompile } from "../runners/compile/webpack.js";
import { printAndMaybeWriteResult } from "../src/shared/utils.js";

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

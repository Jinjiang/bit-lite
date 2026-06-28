import runBiomeLint from "../../src/runners/lint/biome.js";
import runEslintLint from "../../src/runners/lint/eslint.js";
import runOxlintLint from "../../src/runners/lint/oxlint.js";
import { demoRuns, printAndMaybeWriteResult } from "./demo-options.js";

const results = [
  await runEslintLint(demoRuns["lint:eslint"]),
  await runOxlintLint(demoRuns["lint:oxlint"]),
  await runBiomeLint(demoRuns["lint:biome"]),
];

await printAndMaybeWriteResult(results, "lint.json");
process.exitCode = 0;

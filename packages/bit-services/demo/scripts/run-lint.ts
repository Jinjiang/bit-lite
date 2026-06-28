import runBiomeLint from "../../src/runners/lint/biome.js";
import runEslintLint from "../../src/runners/lint/eslint.js";
import runOxlintLint from "../../src/runners/lint/oxlint.js";
import { printAndMaybeWriteResult } from "../../src/shared/utils.js";

const results = [
  await runEslintLint(),
  await runOxlintLint(),
  await runBiomeLint(),
];

await printAndMaybeWriteResult(results, "lint.json");
process.exitCode = 0;

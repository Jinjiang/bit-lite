import { runBiomeLint } from "../runners/lint/biome.js";
import { runEslintLint } from "../runners/lint/eslint.js";
import { runOxlintLint } from "../runners/lint/oxlint.js";
import { printAndMaybeWriteResult } from "../src/shared/utils.js";

const results = [
  await runEslintLint(),
  await runOxlintLint(),
  await runBiomeLint(),
];

await printAndMaybeWriteResult(results, "lint.json");
process.exitCode = 0;

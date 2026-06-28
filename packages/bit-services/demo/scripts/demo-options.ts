import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DemoServiceResult, ServiceRunOptions } from "../../src/types/index.js";

export const demoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const resultsRoot = path.join(demoRoot, "results");
export const artifactsRoot = path.join(resultsRoot, "artifacts");

export const demoRuns = {
  "compile:babel": compileTarget("compile/babel/input.tsx"),
  "compile:esbuild": compileTarget("compile/esbuild/input.tsx"),
  "compile:oxc": compileTarget("compile/oxc/input.tsx"),
  "compile:rollup": compileTarget("compile/rollup/entry.ts"),
  "compile:swc": compileTarget("compile/swc/input.tsx"),
  "compile:typescript": compileTarget("compile/typescript/input.ts"),
  "compile:vite": compileTarget("compile/vite/entry.ts"),
  "compile:vue-sfc": compileTarget("compile/vue-sfc/Hello.vue"),
  "compile:webpack": compileTarget("compile/webpack/entry.ts"),
  "lint:biome": {
    cwd: demoRoot,
    targetFiles: ["targets/lint/biome/bad.js"],
    configFile: "configs/biome.json",
  },
  "lint:eslint": {
    cwd: demoRoot,
    targetFiles: ["targets/lint/eslint/bad.js"],
  },
  "lint:oxlint": {
    cwd: demoRoot,
    targetFiles: ["targets/lint/oxlint/bad.js"],
  },
  "test:cypress": {
    cwd: demoRoot,
    targetFiles: ["targets/test/cypress/e2e/sample.cy.ts"],
    projectDir: "targets/test/cypress",
    configFile: "configs/cypress-silent-reporter.cjs",
  },
  "test:jest": {
    cwd: demoRoot,
    targetFiles: ["targets/test/jest/sample.test.cjs"],
  },
  "test:mocha": {
    cwd: demoRoot,
    targetFiles: ["targets/test/mocha/sample.test.mjs"],
  },
  "test:playwright": {
    cwd: demoRoot,
    targetFiles: ["targets/test/playwright/sample.spec.ts"],
    configFile: "configs/playwright.config.ts",
  },
  "test:vitest": {
    cwd: demoRoot,
    targetFiles: ["targets/test/vitest/sample.test.ts"],
    configFile: "configs/vitest.config.ts",
  },
} satisfies Record<string, ServiceRunOptions>;

export async function printAndMaybeWriteResult(
  result: DemoServiceResult | DemoServiceResult[],
  outputName?: string,
) {
  if (outputName) {
    await mkdir(resultsRoot, { recursive: true });
    await writeFile(path.join(resultsRoot, outputName), `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
}

function compileTarget(targetFile: string): ServiceRunOptions {
  return {
    cwd: demoRoot,
    targetFiles: [`targets/${targetFile}`],
    outputDir: artifactsRoot,
  };
}

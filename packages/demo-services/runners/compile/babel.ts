import { transformFileAsync } from "@babel/core";
import path from "node:path";
import {
  createTimer,
  demoRoot,
  isDirectRun,
  makeCompileResult,
  printAndMaybeWriteResult,
  relativePath,
  writeArtifact,
} from "../../src/shared/utils.js";
import type { CompileServiceResult } from "../../src/types/service-results.js";

export async function runBabelCompile(): Promise<CompileServiceResult> {
  const target = path.join(demoRoot, "targets/compile/babel/input.tsx");
  const elapsed = createTimer();
  const result = await transformFileAsync(target, {
    filename: target,
    babelrc: false,
    configFile: false,
    sourceMaps: true,
    presets: [
      ["@babel/preset-typescript", { ignoreExtensions: true }],
      ["@babel/preset-react", { runtime: "automatic" }],
    ],
  });
  const code = result?.code ?? "";
  const outputPath = await writeArtifact("babel", "input.js", code);

  return makeCompileResult({
    vendor: "babel",
    apiKind: "js-api",
    ok: Boolean(result),
    durationMs: elapsed(),
    targetFiles: [target],
    outputs: [
      {
        kind: "js",
        filePath: relativePath(outputPath),
        code,
        bytes: Buffer.byteLength(code),
      },
    ],
    notes: ["@babel/core exposes transformFileAsync/transformSync JS APIs."],
  });
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runBabelCompile());
}

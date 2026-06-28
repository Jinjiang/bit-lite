import path from "node:path";
import { transformFile } from "@swc/core";
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

export async function runSwcCompile(): Promise<CompileServiceResult> {
  const target = path.join(demoRoot, "targets/compile/swc/input.tsx");
  const elapsed = createTimer();
  const result = await transformFile(target, {
    filename: target,
    sourceMaps: true,
    jsc: {
      parser: {
        syntax: "typescript",
        tsx: true,
      },
      target: "es2022",
      transform: {
        react: {
          runtime: "automatic",
        },
      },
    },
    module: {
      type: "es6",
    },
  });
  const outputPath = await writeArtifact("swc", "input.js", result.code);

  return makeCompileResult({
    vendor: "swc",
    apiKind: "js-api",
    ok: true,
    durationMs: elapsed(),
    targetFiles: [target],
    outputs: [
      {
        kind: "js",
        filePath: relativePath(outputPath),
        code: result.code,
        bytes: Buffer.byteLength(result.code),
      },
    ],
    notes: ["@swc/core exposes transform and transformFile JS APIs."],
  });
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runSwcCompile());
}


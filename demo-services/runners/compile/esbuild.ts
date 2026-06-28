import { readFile } from "node:fs/promises";
import path from "node:path";
import { transform } from "esbuild";
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

export async function runEsbuildCompile(): Promise<CompileServiceResult> {
  const target = path.join(demoRoot, "targets/compile/esbuild/input.tsx");
  const elapsed = createTimer();
  const source = await readFile(target, "utf8");
  const result = await transform(source, {
    loader: "tsx",
    format: "esm",
    sourcemap: true,
    sourcefile: target,
    target: "es2022",
    jsx: "automatic",
  });
  const outputPath = await writeArtifact("esbuild", "input.js", result.code);

  return makeCompileResult({
    vendor: "esbuild",
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
    notes: ["esbuild exposes transform/build/context JS APIs; context can support watch mode."],
  });
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runEsbuildCompile());
}


import { readFile } from "node:fs/promises";
import path from "node:path";
import { transform } from "esbuild";
import {
  createTimer,
  demoRoot,
  makeCompileResult,
  relativePath,
  resolveRunOptions,
  writeArtifact,
} from "../../shared/utils.js";
import type { CompileServiceResult, ServiceRunOptions } from "../../types/service-results.js";

export async function runEsbuildCompile(options?: ServiceRunOptions): Promise<CompileServiceResult> {
  const run = resolveRunOptions(options, {
    targetFiles: [path.join(demoRoot, "targets/compile/esbuild/input.tsx")],
  });
  const target = run.targetFiles[0];
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
  const outputPath = await writeArtifact("esbuild", "input.js", result.code, run.outputDir);

  return makeCompileResult({
    vendor: "esbuild",
    apiKind: "js-api",
    ok: true,
    durationMs: elapsed(),
    targetFiles: run.targetFiles,
    outputs: [
      {
        kind: "js",
        filePath: relativePath(outputPath, run.cwd),
        code: result.code,
        bytes: Buffer.byteLength(result.code),
      },
    ],
    baseDir: run.cwd,
    notes: ["esbuild exposes transform/build/context JS APIs; context can support watch mode."],
  });
}


export default runEsbuildCompile;

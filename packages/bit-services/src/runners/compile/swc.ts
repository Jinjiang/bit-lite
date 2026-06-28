import path from "node:path";
import { transformFile } from "@swc/core";
import {
  createTimer,
  demoRoot,
  makeCompileResult,
  relativePath,
  resolveRunOptions,
  writeArtifact,
} from "../../shared/utils.js";
import type { CompileServiceResult, ServiceRunOptions } from "../../types/service-results.js";

export async function runSwcCompile(options?: ServiceRunOptions): Promise<CompileServiceResult> {
  const run = resolveRunOptions(options, {
    targetFiles: [path.join(demoRoot, "targets/compile/swc/input.tsx")],
  });
  const target = run.targetFiles[0];
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
  const outputPath = await writeArtifact("swc", "input.js", result.code, run.outputDir);

  return makeCompileResult({
    vendor: "swc",
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
    notes: ["@swc/core exposes transform and transformFile JS APIs."],
  });
}


export default runSwcCompile;

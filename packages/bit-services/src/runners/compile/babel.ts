import { transformFileAsync } from "@babel/core";
import path from "node:path";
import {
  createTimer,
  demoRoot,
  makeCompileResult,
  relativePath,
  resolveRunOptions,
  writeArtifact,
} from "../../shared/utils.js";
import type { CompileServiceResult, ServiceRunOptions } from "../../types/service-results.js";

export async function runBabelCompile(options?: ServiceRunOptions): Promise<CompileServiceResult> {
  const run = resolveRunOptions(options, {
    targetFiles: [path.join(demoRoot, "targets/compile/babel/input.tsx")],
  });
  const target = run.targetFiles[0];
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
  const outputPath = await writeArtifact("babel", "input.js", code, run.outputDir);

  return makeCompileResult({
    vendor: "babel",
    apiKind: "js-api",
    ok: Boolean(result),
    durationMs: elapsed(),
    targetFiles: run.targetFiles,
    outputs: [
      {
        kind: "js",
        filePath: relativePath(outputPath, run.cwd),
        code,
        bytes: Buffer.byteLength(code),
      },
    ],
    baseDir: run.cwd,
    notes: ["@babel/core exposes transformFileAsync/transformSync JS APIs."],
  });
}


export default runBabelCompile;

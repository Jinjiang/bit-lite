import { build } from "vite";
import {
  createTimer,
  makeCompileResult,
  relativePath,
  resolveRunOptions,
  writeArtifact,
} from "../../shared/utils.js";
import type { CompileOutput, CompileServiceResult, ServiceRunOptions } from "../../types/service-results.js";

export async function runViteCompile(options: ServiceRunOptions): Promise<CompileServiceResult> {
  const run = resolveRunOptions(options);
  const target = run.targetFiles[0];
  const elapsed = createTimer();
  const result = await build({
    configFile: false,
    root: run.cwd,
    logLevel: "silent",
    build: {
      emptyOutDir: false,
      write: false,
      lib: {
        entry: target,
        formats: ["es"],
        fileName: "entry",
      },
    },
  });
  const outputs: CompileOutput[] = [];
  const rollupOutputs = (Array.isArray(result) ? result : [result]) as Array<{ output?: unknown[] }>;
  for (const output of rollupOutputs.flatMap((item) => item.output ?? []) as any[]) {
    if (output.type === "chunk") {
      const outputPath = await writeArtifact("vite", output.fileName, output.code, run.outputDir);
      outputs.push({
        kind: "js",
        filePath: relativePath(outputPath, run.cwd),
        code: output.code,
        bytes: Buffer.byteLength(output.code),
      });
    }
  }

  return makeCompileResult({
    vendor: "vite",
    apiKind: "js-api",
    ok: true,
    durationMs: elapsed(),
    targetFiles: run.targetFiles,
    outputs,
    baseDir: run.cwd,
    notes: ["Vite exposes build/createServer JS APIs and can return Rollup output when write=false."],
  });
}


export default runViteCompile;

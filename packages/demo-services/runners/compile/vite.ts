import path from "node:path";
import { build } from "vite";
import {
  createTimer,
  demoRoot,
  isDirectRun,
  makeCompileResult,
  printAndMaybeWriteResult,
  relativePath,
  writeArtifact,
} from "../../src/shared/utils.js";
import type { CompileOutput, CompileServiceResult } from "../../src/types/service-results.js";

export async function runViteCompile(): Promise<CompileServiceResult> {
  const target = path.join(demoRoot, "targets/compile/vite/entry.ts");
  const elapsed = createTimer();
  const result = await build({
    configFile: false,
    root: demoRoot,
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
      const outputPath = await writeArtifact("vite", output.fileName, output.code);
      outputs.push({
        kind: "js",
        filePath: relativePath(outputPath),
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
    targetFiles: [target],
    outputs,
    notes: ["Vite exposes build/createServer JS APIs and can return Rollup output when write=false."],
  });
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runViteCompile());
}

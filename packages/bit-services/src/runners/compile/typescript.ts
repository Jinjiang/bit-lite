import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import {
  createTimer,
  demoRoot,
  makeCompileResult,
  relativePath,
  resolveRunOptions,
  writeArtifact,
} from "../../shared/utils.js";
import type { CompileServiceResult, ServiceDiagnostic, ServiceRunOptions } from "../../types/service-results.js";

export async function runTypeScriptCompile(options?: ServiceRunOptions): Promise<CompileServiceResult> {
  const run = resolveRunOptions(options, {
    targetFiles: [path.join(demoRoot, "targets/compile/typescript/input.ts")],
  });
  const target = run.targetFiles[0];
  const elapsed = createTimer();
  const source = await readFile(target, "utf8");
  const result = ts.transpileModule(source, {
    fileName: target,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });
  const outputPath = await writeArtifact("typescript", "input.js", result.outputText, run.outputDir);
  const diagnostics: ServiceDiagnostic[] = (result.diagnostics ?? []).map((diagnostic) => ({
    severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
    source: "typescript",
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    location: diagnostic.file
      ? {
          filePath: relativePath(diagnostic.file.fileName, run.cwd) ?? diagnostic.file.fileName,
        }
      : undefined,
  }));

  return makeCompileResult({
    vendor: "typescript",
    apiKind: "js-api",
    ok: diagnostics.every((item) => item.severity !== "error"),
    durationMs: elapsed(),
    targetFiles: run.targetFiles,
    outputs: [
      {
        kind: "js",
        filePath: relativePath(outputPath, run.cwd),
        code: result.outputText,
        bytes: Buffer.byteLength(result.outputText),
      },
    ],
    diagnostics,
    baseDir: run.cwd,
    notes: ["TypeScript transpileModule is a JS API path for single-file TS to JS emit."],
  });
}


export default runTypeScriptCompile;

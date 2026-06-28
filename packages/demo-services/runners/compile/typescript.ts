import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import {
  createTimer,
  demoRoot,
  isDirectRun,
  makeCompileResult,
  printAndMaybeWriteResult,
  relativePath,
  writeArtifact,
} from "../../src/shared/utils.js";
import type { CompileServiceResult, ServiceDiagnostic } from "../../src/types/service-results.js";

export async function runTypeScriptCompile(): Promise<CompileServiceResult> {
  const target = path.join(demoRoot, "targets/compile/typescript/input.ts");
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
  const outputPath = await writeArtifact("typescript", "input.js", result.outputText);
  const diagnostics: ServiceDiagnostic[] = (result.diagnostics ?? []).map((diagnostic) => ({
    severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
    source: "typescript",
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    location: diagnostic.file
      ? {
          filePath: relativePath(diagnostic.file.fileName) ?? diagnostic.file.fileName,
        }
      : undefined,
  }));

  return makeCompileResult({
    vendor: "typescript",
    apiKind: "js-api",
    ok: diagnostics.every((item) => item.severity !== "error"),
    durationMs: elapsed(),
    targetFiles: [target],
    outputs: [
      {
        kind: "js",
        filePath: relativePath(outputPath),
        code: result.outputText,
        bytes: Buffer.byteLength(result.outputText),
      },
    ],
    diagnostics,
    notes: ["TypeScript transpileModule is a JS API path for single-file TS to JS emit."],
  });
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runTypeScriptCompile());
}


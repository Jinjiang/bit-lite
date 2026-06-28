import { readFile } from "node:fs/promises";
import path from "node:path";
import { transform } from "oxc-transform";
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

export async function runOxcCompile(): Promise<CompileServiceResult> {
  const target = path.join(demoRoot, "targets/compile/oxc/input.tsx");
  const elapsed = createTimer();
  const source = await readFile(target, "utf8");
  const result = await transform(target, source, {
    lang: "tsx",
    jsx: {
      runtime: "automatic",
    },
    sourcemap: true,
  } as any) as {
    code: string;
    map?: string;
    errors?: Array<{ message?: string }>;
  };
  const outputPath = await writeArtifact("oxc", "input.js", result.code);
  const diagnostics: ServiceDiagnostic[] = (result.errors ?? []).map((error) => ({
    severity: "error",
    source: "oxc",
    message: error.message ?? "OXC transform error",
    location: {
      filePath: relativePath(target) ?? target,
    },
  }));

  return makeCompileResult({
    vendor: "oxc",
    apiKind: "js-api",
    ok: diagnostics.length === 0,
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
    diagnostics,
    notes: ["oxc-transform exposes a Node API; this is the OXC compiler-side counterpart to oxlint."],
  });
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runOxcCompile());
}

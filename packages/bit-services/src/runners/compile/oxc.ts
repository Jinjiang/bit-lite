import { readFile } from "node:fs/promises";
import path from "node:path";
import { transform } from "oxc-transform";
import {
  createTimer,
  demoRoot,
  makeCompileResult,
  relativePath,
  resolveRunOptions,
  writeArtifact,
} from "../../shared/utils.js";
import type { CompileServiceResult, ServiceDiagnostic, ServiceRunOptions } from "../../types/service-results.js";

export async function runOxcCompile(options?: ServiceRunOptions): Promise<CompileServiceResult> {
  const run = resolveRunOptions(options, {
    targetFiles: [path.join(demoRoot, "targets/compile/oxc/input.tsx")],
  });
  const target = run.targetFiles[0];
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
  const outputPath = await writeArtifact("oxc", "input.js", result.code, run.outputDir);
  const diagnostics: ServiceDiagnostic[] = (result.errors ?? []).map((error) => ({
    severity: "error",
    source: "oxc",
    message: error.message ?? "OXC transform error",
    location: {
      filePath: relativePath(target, run.cwd) ?? target,
    },
  }));

  return makeCompileResult({
    vendor: "oxc",
    apiKind: "js-api",
    ok: diagnostics.length === 0,
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
    diagnostics,
    baseDir: run.cwd,
    notes: ["oxc-transform exposes a Node API; this is the OXC compiler-side counterpart to oxlint."],
  });
}


export default runOxcCompile;

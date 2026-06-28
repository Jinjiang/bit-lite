import typescriptModule from "@rollup/plugin-typescript";
import path from "node:path";
import { rollup, type Plugin } from "rollup";
import {
  createTimer,
  demoRoot,
  makeCompileResult,
  relativePath,
  resolveRunOptions,
  writeArtifact,
} from "../../shared/utils.js";
import type { CompileOutput, CompileServiceResult, ServiceDiagnostic, ServiceRunOptions } from "../../types/service-results.js";

const typescript = typescriptModule as unknown as (options: Record<string, unknown>) => Plugin;

export async function runRollupCompile(options?: ServiceRunOptions): Promise<CompileServiceResult> {
  const run = resolveRunOptions(options, {
    targetFiles: [path.join(demoRoot, "targets/compile/rollup/entry.ts")],
  });
  const target = run.targetFiles[0];
  const elapsed = createTimer();
  const diagnostics: ServiceDiagnostic[] = [];
  const bundle = await rollup({
    input: target,
    plugins: [
      typescript({
        tsconfig: false,
        include: [target],
        compilerOptions: {
          ignoreDeprecations: "6.0",
          jsx: "react-jsx",
          moduleResolution: "bundler",
        },
        sourceMap: true,
      }),
    ],
    onwarn(warning) {
      diagnostics.push({
        severity: "warning",
        source: "rollup",
        ruleId: warning.code,
        message: warning.message,
      });
    },
  });
  const generated = await bundle.generate({
    format: "es",
    sourcemap: true,
  });
  await bundle.close();
  const outputs: CompileOutput[] = [];
  for (const output of generated.output) {
    if (output.type === "chunk") {
      const outputPath = await writeArtifact("rollup", output.fileName, output.code, run.outputDir);
      outputs.push({
        kind: "js",
        filePath: relativePath(outputPath, run.cwd),
        code: output.code,
        bytes: Buffer.byteLength(output.code),
      });
    }
  }

  return makeCompileResult({
    vendor: "rollup",
    apiKind: "js-api",
    ok: diagnostics.every((item) => item.severity !== "error"),
    durationMs: elapsed(),
    targetFiles: run.targetFiles,
    outputs,
    diagnostics,
    baseDir: run.cwd,
    notes: ["Rollup exposes rollup()/watch() JS APIs; TypeScript support comes through a plugin."],
  });
}


export default runRollupCompile;

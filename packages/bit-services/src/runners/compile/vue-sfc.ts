import { readFile } from "node:fs/promises";
import path from "node:path";
import { transform } from "esbuild";
import { compileScript, compileStyle, compileTemplate, parse } from "@vue/compiler-sfc";
import {
  createTimer,
  demoRoot,
  makeCompileResult,
  relativePath,
  resolveRunOptions,
  writeArtifact,
} from "../../shared/utils.js";
import type {
  CompileOutput,
  CompileServiceResult,
  ServiceDiagnostic,
  ServiceRunOptions,
} from "../../types/service-results.js";

export async function runVueSfcCompile(options?: ServiceRunOptions): Promise<CompileServiceResult> {
  const run = resolveRunOptions(options, {
    targetFiles: [path.join(demoRoot, "targets/compile/vue-sfc/Hello.vue")],
  });
  const target = run.targetFiles[0];
  const elapsed = createTimer();
  const source = await readFile(target, "utf8");
  const parsed = parse(source, { filename: target });
  const diagnostics: ServiceDiagnostic[] = parsed.errors.map((error) => ({
    severity: "error",
    source: "vue-sfc",
    message: error instanceof Error ? error.message : String(error),
    location: {
      filePath: relativePath(target, run.cwd) ?? target,
    },
  }));
  const descriptor = parsed.descriptor;
  const script = compileScript(descriptor, {
    id: "demo-vue-sfc",
  });
  const template = compileTemplate({
    id: "demo-vue-sfc",
    filename: target,
    source: descriptor.template?.content ?? "",
    scoped: descriptor.styles.some((style) => style.scoped),
  });
  diagnostics.push(
    ...template.errors.map((error) => ({
      severity: "error" as const,
      source: "vue-template",
      message: error instanceof Error ? error.message : String(error),
      location: {
        filePath: relativePath(target, run.cwd) ?? target,
      },
    })),
  );
  const cssOutputs = descriptor.styles.map((style, index) =>
    compileStyle({
      filename: target,
      id: "demo-vue-sfc",
      source: style.content,
      scoped: style.scoped,
    }),
  );
  const scriptCode = script.content.replace("export default", "const __sfc__ =");
  const templateCode = template.code.replace("export function render", "function render");
  const combined = `${scriptCode}\n${templateCode}\n__sfc__.render = render;\nexport default __sfc__;\n`;
  const transformed = await transform(combined, {
    loader: "ts",
    format: "esm",
    target: "es2022",
  });
  const jsPath = await writeArtifact("vue-sfc", "Hello.js", transformed.code, run.outputDir);
  const outputs: CompileOutput[] = [
    {
      kind: "js",
      filePath: relativePath(jsPath, run.cwd),
      code: transformed.code,
      bytes: Buffer.byteLength(transformed.code),
    },
  ];
  for (const [index, css] of cssOutputs.entries()) {
    const cssPath = await writeArtifact("vue-sfc", `Hello.${index}.css`, css.code, run.outputDir);
    outputs.push({
      kind: "css",
      filePath: relativePath(cssPath, run.cwd),
      code: css.code,
      bytes: Buffer.byteLength(css.code),
    });
    diagnostics.push(
      ...css.errors.map((error) => ({
        severity: "error" as const,
        source: "vue-style",
        message: error instanceof Error ? error.message : String(error),
        location: {
          filePath: relativePath(target, run.cwd) ?? target,
        },
      })),
    );
  }

  return makeCompileResult({
    vendor: "vue-sfc",
    apiKind: "js-api",
    ok: diagnostics.every((item) => item.severity !== "error"),
    durationMs: elapsed(),
    targetFiles: run.targetFiles,
    outputs,
    diagnostics,
    baseDir: run.cwd,
    notes: [
      "@vue/compiler-sfc parses and compiles Vue SFC pieces; this demo uses esbuild only to strip TS from the generated script.",
    ],
  });
}


export default runVueSfcCompile;

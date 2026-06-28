import { readFile } from "node:fs/promises";
import path from "node:path";
import webpack from "webpack";
import {
  artifactsRoot,
  createTimer,
  demoRoot,
  isDirectRun,
  makeCompileResult,
  printAndMaybeWriteResult,
  relativePath,
} from "../../src/shared/utils.js";
import type { CompileServiceResult, ServiceDiagnostic } from "../../src/types/service-results.js";

export async function runWebpackCompile(): Promise<CompileServiceResult> {
  const target = path.join(demoRoot, "targets/compile/webpack/entry.ts");
  const outputDir = path.join(artifactsRoot, "webpack");
  const outputFile = "bundle.js";
  const elapsed = createTimer();
  const compiler = webpack({
    mode: "development",
    devtool: false,
    target: ["web", "es2022"],
    entry: target,
    output: {
      path: outputDir,
      filename: outputFile,
      library: {
        type: "module",
      },
    },
    experiments: {
      outputModule: true,
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          loader: "ts-loader",
          options: {
            transpileOnly: true,
            compilerOptions: {
              module: "esnext",
              moduleResolution: "bundler",
              ignoreDeprecations: "6.0",
            },
          },
        },
      ],
    },
    stats: "errors-warnings",
  });

  const stats = await new Promise<webpack.Stats>((resolve, reject) => {
    compiler.run((error, value) => {
      compiler.close((closeError) => {
        if (error ?? closeError ?? !value) {
          reject(error ?? closeError ?? new Error("webpack did not return stats"));
          return;
        }
        resolve(value);
      });
    });
  });
  const json = stats.toJson({ all: false, errors: true, warnings: true, assets: true });
  const diagnostics: ServiceDiagnostic[] = [
    ...(json.errors ?? []).map((error) => ({
      severity: "error" as const,
      source: "webpack",
      message: error.message ?? "webpack error",
      location: error.moduleName
        ? {
            filePath: error.moduleName,
          }
        : undefined,
    })),
    ...(json.warnings ?? []).map((warning) => ({
      severity: "warning" as const,
      source: "webpack",
      message: warning.message ?? "webpack warning",
      location: warning.moduleName
        ? {
            filePath: warning.moduleName,
          }
        : undefined,
    })),
  ];
  const bundlePath = path.join(outputDir, outputFile);
  const code = await readFile(bundlePath, "utf8");

  return makeCompileResult({
    vendor: "webpack",
    apiKind: "js-api",
    ok: !stats.hasErrors(),
    durationMs: elapsed(),
    targetFiles: [target],
    outputs: [
      {
        kind: "js",
        filePath: relativePath(bundlePath),
        code,
        bytes: Buffer.byteLength(code),
      },
    ],
    diagnostics,
    notes: ["webpack exposes a Node API and watch compiler; stats.toJson() is structured."],
    raw: json,
  });
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runWebpackCompile());
}

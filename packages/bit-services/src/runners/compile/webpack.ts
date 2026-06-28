import { readFile } from "node:fs/promises";
import path from "node:path";
import webpack from "webpack";
import {
  createTimer,
  makeCompileResult,
  relativePath,
  resolveRunOptions,
} from "../../shared/utils.js";
import type { CompileServiceResult, ServiceDiagnostic, ServiceRunOptions } from "../../types/service-results.js";

export async function runWebpackCompile(options: ServiceRunOptions): Promise<CompileServiceResult> {
  const run = resolveRunOptions(options);
  const target = run.targetFiles[0];
  const outputDir = path.join(run.outputDir, "webpack");
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
            filePath: relativePath(error.moduleName, run.cwd) ?? error.moduleName,
          }
        : undefined,
    })),
    ...(json.warnings ?? []).map((warning) => ({
      severity: "warning" as const,
      source: "webpack",
      message: warning.message ?? "webpack warning",
      location: warning.moduleName
        ? {
            filePath: relativePath(warning.moduleName, run.cwd) ?? warning.moduleName,
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
    targetFiles: run.targetFiles,
    outputs: [
      {
        kind: "js",
        filePath: relativePath(bundlePath, run.cwd),
        code,
        bytes: Buffer.byteLength(code),
      },
    ],
    diagnostics,
    baseDir: run.cwd,
    notes: ["webpack exposes a Node API and watch compiler; stats.toJson() is structured."],
    raw: json,
  });
}


export default runWebpackCompile;

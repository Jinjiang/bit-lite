import { ESLint } from "eslint";
import path from "node:path";
import {
  createTimer,
  demoRoot,
  makeLintResult,
  relativePath,
  resolveRunOptions,
} from "../../shared/utils.js";
import type { LintServiceResult, ServiceDiagnostic, ServiceRunOptions } from "../../types/service-results.js";

export async function runEslintLint(options?: ServiceRunOptions): Promise<LintServiceResult> {
  const run = resolveRunOptions(options, {
    targetFiles: [path.join(demoRoot, "targets/lint/eslint/bad.js")],
  });
  const elapsed = createTimer();
  const eslint = new ESLint({
    cwd: run.cwd,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.js"],
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: "module",
        },
        rules: {
          "no-unused-vars": "error",
          quotes: ["error", "double"],
          semi: ["error", "always"],
        },
      },
    ],
  });
  const results = await eslint.lintFiles(run.targetFiles);
  const diagnostics: ServiceDiagnostic[] = results.flatMap((result) =>
    result.messages.map((message) => ({
      severity: message.severity === 2 ? "error" : "warning",
      source: "eslint",
      ruleId: message.ruleId ?? undefined,
      message: message.message,
      location: {
        filePath: relativePath(result.filePath, run.cwd) ?? result.filePath,
        line: message.line,
        column: message.column,
        endLine: message.endLine,
        endColumn: message.endColumn,
      },
    })),
  );

  return makeLintResult({
    vendor: "eslint",
    apiKind: "js-api",
    ok: diagnostics.every((item) => item.severity !== "error"),
    durationMs: elapsed(),
    targetFiles: run.targetFiles,
    diagnostics,
    baseDir: run.cwd,
    raw: results,
  });
}


export default runEslintLint;

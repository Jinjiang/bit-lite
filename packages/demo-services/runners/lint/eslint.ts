import { ESLint } from "eslint";
import path from "node:path";
import {
  createTimer,
  demoRoot,
  isDirectRun,
  makeLintResult,
  printAndMaybeWriteResult,
  relativePath,
} from "../../src/shared/utils.js";
import type { LintServiceResult, ServiceDiagnostic } from "../../src/types/service-results.js";

export async function runEslintLint(): Promise<LintServiceResult> {
  const target = path.join(demoRoot, "targets/lint/eslint/bad.js");
  const elapsed = createTimer();
  const eslint = new ESLint({
    cwd: demoRoot,
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
  const results = await eslint.lintFiles([target]);
  const diagnostics: ServiceDiagnostic[] = results.flatMap((result) =>
    result.messages.map((message) => ({
      severity: message.severity === 2 ? "error" : "warning",
      source: "eslint",
      ruleId: message.ruleId ?? undefined,
      message: message.message,
      location: {
        filePath: relativePath(result.filePath) ?? result.filePath,
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
    targetFiles: [target],
    diagnostics,
    raw: results,
  });
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runEslintLint());
}


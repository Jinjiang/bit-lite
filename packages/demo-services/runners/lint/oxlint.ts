import path from "node:path";
import {
  createTimer,
  demoRoot,
  isDirectRun,
  makeLintResult,
  packagePath,
  parseJsonOutput,
  printAndMaybeWriteResult,
  relativePath,
  runCommand,
} from "../../src/shared/utils.js";
import type { LintServiceResult, ServiceDiagnostic, Severity } from "../../src/types/service-results.js";

function normalizeSeverity(value: unknown): Severity {
  if (value === "warning" || value === "warn" || value === 1) {
    return "warning";
  }
  if (value === "info") {
    return "info";
  }
  return "error";
}

function mapOxlintDiagnostics(raw: unknown): ServiceDiagnostic[] {
  const value = raw as { diagnostics?: unknown[]; errors?: unknown[] };
  const diagnostics = Array.isArray(raw) ? raw : value?.diagnostics ?? value?.errors ?? [];
  return diagnostics.map((item) => {
    const diagnostic = item as {
      code?: string;
      ruleId?: string;
      rule?: string;
      message?: string;
      severity?: unknown;
      filename?: string;
      filePath?: string;
      line?: number;
      column?: number;
      labels?: Array<{
        file?: string;
        filename?: string;
        line?: number;
        column?: number;
        span?: {
          file?: string;
          line?: number;
          column?: number;
        };
      }>;
    };
    const label = diagnostic.labels?.[0];
    const filePath =
      diagnostic.filePath ??
      diagnostic.filename ??
      label?.file ??
      label?.filename ??
      label?.span?.file;
    return {
      severity: normalizeSeverity(diagnostic.severity),
      source: "oxlint",
      ruleId: diagnostic.code ?? diagnostic.ruleId ?? diagnostic.rule,
      message: diagnostic.message ?? "Oxlint diagnostic",
      location: filePath
        ? {
            filePath: relativePath(filePath) ?? filePath,
            line: diagnostic.line ?? label?.line ?? label?.span?.line,
            column: diagnostic.column ?? label?.column ?? label?.span?.column,
          }
        : undefined,
    };
  });
}

export async function runOxlintLint(): Promise<LintServiceResult> {
  const target = path.join(demoRoot, "targets/lint/oxlint/bad.js");
  const elapsed = createTimer();
  const oxlintBin = packagePath("oxlint", "bin/oxlint");
  const command = await runCommand(oxlintBin, ["--format", "json", "--deny", "no-unused-vars", target]);
  const raw = command.stdout.trim() ? parseJsonOutput(command.stdout) : undefined;
  const diagnostics = mapOxlintDiagnostics(raw);

  return makeLintResult({
    vendor: "oxlint",
    apiKind: "cli-json",
    ok: command.exitCode === 0 && diagnostics.every((item) => item.severity !== "error"),
    durationMs: elapsed(),
    targetFiles: [target],
    diagnostics,
    notes: [
      "The oxlint npm package exposes config helpers, but this demo uses CLI JSON because a stable lint execution JS API is not exposed.",
    ],
    raw: raw ?? { stderr: command.stderr, exitCode: command.exitCode },
  });
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runOxlintLint());
}

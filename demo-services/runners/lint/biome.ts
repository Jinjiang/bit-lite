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
  if (value === "warning" || value === "warn") {
    return "warning";
  }
  if (value === "information" || value === "info") {
    return "info";
  }
  return "error";
}

function mapBiomeDiagnostics(raw: unknown): ServiceDiagnostic[] {
  const value = raw as { diagnostics?: unknown[] };
  return (value?.diagnostics ?? []).map((item) => {
    const diagnostic = item as {
      category?: string;
      severity?: unknown;
      description?: string;
      message?: { content?: string } | string;
      location?: {
        path?: { file?: string } | string;
        start?: { line?: number; column?: number };
        end?: { line?: number; column?: number };
        sourceCode?: string;
        span?: [number, number];
      };
    };
    const message =
      typeof diagnostic.message === "string"
        ? diagnostic.message
        : diagnostic.message?.content ?? diagnostic.description ?? "Biome diagnostic";
    const filePath =
      typeof diagnostic.location?.path === "string"
        ? diagnostic.location.path
        : diagnostic.location?.path?.file;
    return {
      severity: normalizeSeverity(diagnostic.severity),
      source: "biome",
      ruleId: diagnostic.category,
      message,
      location: filePath
        ? {
            filePath: relativePath(filePath) ?? filePath,
            line: diagnostic.location?.start?.line,
            column: diagnostic.location?.start?.column,
            endLine: diagnostic.location?.end?.line,
            endColumn: diagnostic.location?.end?.column,
          }
        : undefined,
    };
  });
}

export async function runBiomeLint(): Promise<LintServiceResult> {
  const target = path.join(demoRoot, "targets/lint/biome/bad.js");
  const config = path.join(demoRoot, "configs/biome.json");
  const elapsed = createTimer();
  const biomeBin = packagePath("@biomejs/biome", "bin/biome");
  const command = await runCommand(biomeBin, [
    "lint",
    "--reporter=json",
    `--config-path=${config}`,
    target,
  ]);
  const raw = command.stdout.trim() ? parseJsonOutput(command.stdout) : undefined;
  const diagnostics = mapBiomeDiagnostics(raw);

  return makeLintResult({
    vendor: "biome",
    apiKind: "cli-json",
    ok: command.exitCode === 0 && diagnostics.every((item) => item.severity !== "error"),
    durationMs: elapsed(),
    targetFiles: [target],
    diagnostics,
    notes: [
      "Biome has @biomejs/js-api, but this demo uses CLI JSON because the linter execution API is not as mature as ESLint's public Node API.",
    ],
    raw: raw ?? { stderr: command.stderr, exitCode: command.exitCode },
  });
}

if (isDirectRun(import.meta.url)) {
  await printAndMaybeWriteResult(await runBiomeLint());
}

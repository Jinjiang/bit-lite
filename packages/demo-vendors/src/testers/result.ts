import path from "node:path";
import type { CliArguments, SelectedEnvIdentity } from "bit-lite-context";
import type { JsonObject, JsonValue } from "bit-lite-vendors";
import type { ComponentTestTarget } from "./files.js";

export type TestVendorMode = "run" | "watch";

export type TestStats = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  summary: string;
};

export type TestComponentResult = {
  componentId: string;
  files: string[];
  stats: TestStats;
  durationMs: number;
  errors: string[];
};

export type TestServiceResult = {
  service: "test";
  vendor: string;
  mode: TestVendorMode;
  run: number;
  context: {
    env: SelectedEnvIdentity;
    componentIds: string[];
    args: CliArguments;
    config: JsonObject;
  };
  stats: TestStats;
  componentResults: TestComponentResult[];
};

export type MutableStats = Omit<TestStats, "summary">;

export type MutableComponentResult = Omit<TestComponentResult, "stats"> & {
  stats: MutableStats;
};

export function createEmptyComponentResults(targets: readonly ComponentTestTarget[]) {
  return targets.map((target) => ({
    componentId: target.component.id,
    files: target.files.map((file) => toPosixPath(path.relative(target.component.rootDir, file))),
    stats: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
    },
    durationMs: 0,
    errors: [],
  }));
}

export function finishComponentResults(results: readonly MutableComponentResult[]): TestComponentResult[] {
  return results.map((result) => ({
    ...result,
    stats: finishStats(result.stats),
  }));
}

export function createTestServiceResult(options: {
  env: SelectedEnvIdentity;
  vendor: string;
  mode: TestVendorMode;
  run: number;
  componentResults: TestComponentResult[];
  args: CliArguments;
  config: Record<string, unknown>;
}): TestServiceResult {
  const totals = options.componentResults.reduce(
    (acc, result) => {
      acc.total += result.stats.total;
      acc.passed += result.stats.passed;
      acc.failed += result.stats.failed;
      acc.skipped += result.stats.skipped;
      return acc;
    },
    { total: 0, passed: 0, failed: 0, skipped: 0 }
  );

  return {
    service: "test",
    vendor: options.vendor,
    mode: options.mode,
    run: options.run,
    context: {
      env: options.env,
      componentIds: options.componentResults.map((result) => result.componentId),
      args: options.args,
      config: toJsonObject(options.config),
    },
    stats: finishStats(totals),
    componentResults: options.componentResults,
  };
}

export function addFileLoadFailure(result: MutableComponentResult, error: unknown) {
  result.stats.total += 1;
  result.stats.failed += 1;
  result.errors.push(formatError(error));
}

export function finishStats(stats: MutableStats): TestStats {
  return {
    ...stats,
    summary: formatSummary(stats),
  };
}

export function formatSummary(result: Pick<TestStats, "total" | "passed" | "failed">) {
  if (result.total === 0) return "0 tests";
  if (result.failed > 0) return `${result.failed}/${result.total} failed`;
  return `${result.passed}/${result.total} passed`;
}

export function formatError(error: unknown) {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function toJsonObject(config: Record<string, unknown>): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(config)) {
    if (isJsonValue(value)) result[key] = value;
  }
  return result;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value).every(isJsonValue);
  return false;
}

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

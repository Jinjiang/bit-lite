import path from "node:path";
import { formatError, isJsonSerializable } from "bit-lite-utils";
import { toPosixPath } from "bit-lite-utils/node";
import type {
  TestComponentResult,
  TestServiceResult,
  TestStats,
  TestVendorMode,
} from "bit-lite-tester";
import type { JsonObject, JsonValue } from "bit-lite-vendors";
import type { ComponentTestTarget } from "./files.js";

/**
 * The reference testers accumulate counts as tests report, then hand the
 * finished shape to the CLI. The shape itself comes from `bit-lite-tester`, so
 * these helpers describe how a vendor reaches it rather than restating what it
 * is; the mutable types below are the accumulation state, not the contract.
 */
export type MutableStats = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
};

export type MutableComponentResult = {
  componentId: string;
  files: string[];
  stats: MutableStats;
  durationMs: number;
  errors: string[];
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
  mode: TestVendorMode;
  run: number;
  componentResults: TestComponentResult[];
  coverage?: JsonValue;
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
    mode: options.mode,
    run: options.run,
    stats: finishStats(totals),
    componentResults: options.componentResults,
    ...(options.coverage === undefined ? {} : { coverage: options.coverage }),
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

export function toJsonObject(config: Record<string, unknown>): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(config)) {
    if (isJsonSerializable(value)) {
      result[key] = value;
    }
  }
  return result;
}

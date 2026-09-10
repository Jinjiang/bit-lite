import { describe, expect, it } from "vitest";
import { isTestComponentResult, isTestServiceResult, isTestStats } from "./index.js";
import type { TestComponentResult, TestServiceResult, TestStats } from "./index.js";

const stats: TestStats = {
  total: 2,
  passed: 2,
  failed: 0,
  skipped: 0,
  summary: "2/2 passed",
};

const componentResult: TestComponentResult = {
  componentId: "components/vitest/math",
  files: ["src/add.test.ts", "src/sub.test.ts"],
  stats,
  durationMs: 12,
  errors: [],
};

const serviceResult: TestServiceResult = {
  mode: "run",
  run: 1,
  stats,
  componentResults: [componentResult],
};

describe("isTestStats", () => {
  it("accepts the four counts and their summary", () => {
    expect(isTestStats(stats)).toBe(true);
  });

  it.each([
    ["not an object", 2],
    ["a missing count", { total: 2, passed: 2, failed: 0, summary: "2/2 passed" }],
    ["a count that is not a number", { ...stats, skipped: "0" }],
    ["a missing summary", { total: 2, passed: 2, failed: 0, skipped: 0 }],
  ])("rejects %s", (_label, value) => {
    expect(isTestStats(value)).toBe(false);
  });
});

describe("isTestComponentResult", () => {
  it("accepts a component's files, counts, duration, and errors", () => {
    expect(isTestComponentResult(componentResult)).toBe(true);
  });

  it.each([
    ["a missing component id", { ...componentResult, componentId: undefined }],
    ["files that are not strings", { ...componentResult, files: [1] }],
    ["stats that are not stats", { ...componentResult, stats: {} }],
    ["a duration that is not a number", { ...componentResult, durationMs: "12" }],
    ["errors that are not strings", { ...componentResult, errors: [{ message: "boom" }] }],
  ])("rejects %s", (_label, value) => {
    expect(isTestComponentResult(value)).toBe(false);
  });
});

describe("isTestServiceResult", () => {
  it.each(["run", "watch"])("accepts a %s result", (mode) => {
    expect(isTestServiceResult({ ...serviceResult, mode })).toBe(true);
  });

  it("accepts a result with no component results, which is how an empty selection reports", () => {
    expect(isTestServiceResult({ ...serviceResult, componentResults: [] })).toBe(true);
  });

  it.each([
    ["a mode the protocol does not define", { ...serviceResult, mode: "debug" }],
    ["a missing run counter", { ...serviceResult, run: undefined }],
    ["run-level stats that are not stats", { ...serviceResult, stats: { total: 2 } }],
    ["component results that are not an array", { ...serviceResult, componentResults: {} }],
    [
      "one malformed component result among valid ones",
      { ...serviceResult, componentResults: [componentResult, { componentId: "x" }] },
    ],
    ["nothing at all", undefined],
  ])("rejects %s", (_label, value) => {
    expect(isTestServiceResult(value)).toBe(false);
  });

  it("accepts extensible JSON data without reserving historical field names", () => {
    // A vendor may report whatever else it knows; the guard checks the fields
    // the protocol names and passes the rest through, so adding coverage or
    // env metadata to a result is not a breaking change.
    expect(isTestServiceResult({ ...serviceResult, coverage: { lines: 100 } })).toBe(true);
    expect(
      isTestServiceResult({
        ...serviceResult,
        env: { packageName: "demo-env-node", version: "1.0.0" },
        service: "test",
        config: {},
      })
    ).toBe(true);
  });
});

import type { JsonObject, JsonValue, VendorRuntime } from "bit-lite-vendors";
import { isJsonObject } from "bit-lite-utils";

/**
 * What: the shape a test vendor publishes and the CLI reads.
 *
 * Why a package rather than a type in the command: this is the boundary
 * between a vendor process and the command that started it, and both sides
 * have to agree on it. Compile has had `bit-lite-compiler` for that since the
 * compiler pipeline was redesigned; the test contract was instead written
 * twice, once in `demo-vendors` where results are produced and once in the
 * `test` command where they are validated. Two declarations of one wire format
 * can drift silently, and a vendor authored outside this repository had
 * nowhere to import the shape from at all.
 */

export type TestVendorMode = "run" | "watch";

/**
 * Counts for one component or for a whole run. `summary` travels with them so
 * every consumer renders the same phrase rather than reformatting the numbers.
 */
export type TestStats = JsonObject & {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  summary: string;
};

export type TestComponentResult = JsonObject & {
  componentId: string;
  files: string[];
  stats: TestStats;
  durationMs: number;
  errors: string[];
};

/**
 * One result message. `run` counts from 1 and increases for each watch-mode
 * re-run, so a consumer can tell a repeat from the first result. `coverage` is
 * whatever the vendor chose to report and is passed through untouched.
 */
export type TestServiceResult = JsonObject & {
  mode: TestVendorMode;
  run: number;
  stats: TestStats;
  componentResults: TestComponentResult[];
  coverage?: JsonValue;
};

/** The runtime a test vendor's start function receives. */
export type TesterVendorRuntime = VendorRuntime<JsonObject, TestServiceResult>;

export function isTestStats(value: unknown): value is TestStats {
  return (
    isJsonObject(value) &&
    typeof value.total === "number" &&
    typeof value.passed === "number" &&
    typeof value.failed === "number" &&
    typeof value.skipped === "number" &&
    typeof value.summary === "string"
  );
}

export function isTestComponentResult(value: unknown): value is TestComponentResult {
  return (
    isJsonObject(value) &&
    typeof value.componentId === "string" &&
    Array.isArray(value.files) &&
    value.files.every((file) => typeof file === "string") &&
    isTestStats(value.stats) &&
    typeof value.durationMs === "number" &&
    Array.isArray(value.errors) &&
    value.errors.every((error) => typeof error === "string")
  );
}

/**
 * The gate every result crosses on its way out of a vendor process. A vendor
 * runs arbitrary third-party code and reports over a JSON channel, so what
 * arrives is unknown until it is checked.
 */
export function isTestServiceResult(value: unknown): value is TestServiceResult {
  return (
    isJsonObject(value) &&
    (value.mode === "run" || value.mode === "watch") &&
    typeof value.run === "number" &&
    isTestStats(value.stats) &&
    Array.isArray(value.componentResults) &&
    value.componentResults.every(isTestComponentResult)
  );
}

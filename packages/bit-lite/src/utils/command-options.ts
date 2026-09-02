import type { CliOptionValue } from "bit-lite-context";
import { BitLiteError } from "./errors.js";

/**
 * Option readers shared by the recording commands, so `snap` and `tag` accept
 * `--dry-run`, `--json`, and `--message` with identical spellings and identical
 * diagnostics.
 */

export function readFlagOption(value: CliOptionValue | undefined, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  // A flag repeated on the command line arrives as an array; treat it as set
  // rather than as a malformed value.
  if (Array.isArray(value) && value.every((item) => typeof item === "boolean")) {
    return value.some(Boolean);
  }
  throw new BitLiteError(`${label} does not take a value`);
}

export function readTextOption(
  value: CliOptionValue | undefined,
  label: string
): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    throw new BitLiteError(`${label} accepts exactly one value`);
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new BitLiteError(`${label} requires a value`);
  }
  return value;
}

import type { CliOptionValue } from "bit-lite-utils";
import { BitLiteError } from "bit-lite-utils";

/**
 * Option readers shared by every command, so a flag reads the same way and
 * fails the same way wherever it appears. The parser has already rejected a
 * non-boolean `=value` for any declared flag, so the throw here covers only an
 * option that reached a command without being declared.
 */

export function readFlagOption(value: CliOptionValue | undefined, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  // A flag repeated on the command line arrives as an array; treat it as set
  // rather than as a malformed value.
  if (Array.isArray(value) && value.every((item) => typeof item === "boolean")) {
    return value.some(Boolean);
  }
  throw new BitLiteError(`${label} requires a boolean value`);
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

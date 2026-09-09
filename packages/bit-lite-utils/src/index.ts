export { formatPatch } from "./unified-diff.js";
export type { PatchComponent, PatchFile, PatchFileSide } from "./unified-diff.js";
/**
 * Marks an error as coming from Bit Lite domain logic rather than a raw system
 * or JavaScript failure, so a command can show its message directly instead of
 * a stack trace.
 *
 * It lives here because every package raises it and none of them should depend
 * on another to name the type. Declaring an equivalent class per package is
 * what this replaces.
 */
export class BitLiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BitLiteError";
  }
}

/**
 * Shapes for the arguments a command was given. They live here rather than with
 * the CLI because they cross the vendor worker boundary as part of
 * `VendorContext`: the CLI produces them and vendors consume them, and neither
 * package should depend on the other to name them.
 */
export type CliOptionScalar = string | number | boolean;
export type CliOptionValue = CliOptionScalar | CliOptionScalar[];
export type CliArguments = {
  raw: string[];
  options: Record<string, CliOptionValue>;
  passthrough: string[];
};

/**
 * The one definition of JSON-safe data in the repository. Env definitions,
 * vendor messages, and preview runtimes all travel as JSON, and each of them
 * declaring its own copy is how those shapes drift apart.
 */
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readStringRecord(value: unknown): Record<string, string> {
  return isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    : {};
}

/**
 * Orders keys by code point rather than by locale. Every record sorted here
 * ends up in a generated file or a compared value, so the order has to be the
 * same on every machine — which `localeCompare` does not promise.
 */
export function sortRecordKeys<Value>(record: Record<string, Value>): Record<string, Value> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  );
}

export function sortStringRecord(record: Record<string, string>): Record<string, string> {
  return sortRecordKeys(record);
}

/** Strict JSON: every number is finite, so the value survives a round trip. */
export function isJsonValue(value: unknown): value is JsonValue {
  return isJsonLike(value, false);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

/**
 * Survives `JSON.stringify` without throwing. `NaN` and the infinities pass
 * here and serialize as `null`, which is the right answer for a vendor copying
 * a foreign tool's configuration through the JSON boundary, and the wrong one
 * for anything that must round-trip.
 */
export function isJsonSerializable(value: unknown): value is JsonValue {
  return isJsonLike(value, true);
}

function isJsonLike(value: unknown, allowNonFiniteNumbers: boolean): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return allowNonFiniteNumbers || Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every((item) => isJsonLike(item, allowNonFiniteNumbers));
  }
  return (
    isRecord(value) &&
    Object.values(value).every((item) => isJsonLike(item, allowNonFiniteNumbers))
  );
}

export function sanitizeFileName(value: string, fallback = "env"): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

const htmlEscapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => htmlEscapes[character] ?? character);
}

export function isFileUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "file:";
  } catch {
    return false;
  }
}

/** `pluralize(1, "component")` is `"component"`; `pluralize(2, …)` is `"components"`. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/** `countOf(2, "component")` is `"2 components"`. */
export function countOf(count: number, singular: string, plural?: string): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}

export function createComponentFileMap<Target extends { files: readonly string[] }, Result>(
  targets: readonly Target[],
  componentResults: readonly Result[],
  normalizePath: (filePath: string) => string
): Map<string, Result> {
  const componentByFile = new Map<string, Result>();
  targets.forEach((target, index) => {
    const result = componentResults[index];
    if (result === undefined) return;
    for (const file of target.files) componentByFile.set(normalizePath(file), result);
  });
  return componentByFile;
}

export function formatExitCode(code: number | null | undefined): string {
  return typeof code === "number" ? String(code) : "unknown";
}

/**
 * Raises the collected failures as one error, or nothing when there are none.
 *
 * Identical failures are collapsed: the same error reaching this twice — a
 * disposal that both failed and was recorded by its caller, say — is one
 * problem, and reporting it twice only makes the report harder to read.
 */
export function throwCombinedErrors(errors: readonly unknown[], message: string): void {
  const distinct = [...new Set(errors)];
  if (distinct.length === 0) return;
  if (distinct.length === 1) throw distinct[0];
  throw new AggregateError(distinct, message);
}

/**
 * The message to show a user. Plain objects carrying a `message` are read too,
 * because a foreign tool can throw one and `String(value)` would render it as
 * `[object Object]`.
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && "message" in error) return String(error.message);
  return String(error);
}

/** The detail to show a developer: a stack when there is one, else the message. */
export function formatErrorStack(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : formatError(error);
}

export function readHost(value: unknown, label: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0) {
    throw new BitLiteError(`${label} requires a host name`);
  }
  return value;
}

/** Accepts a number or its decimal spelling, since a CLI supplies the latter. */
export function readPort(value: unknown, label: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  const port = typeof value === "string" ? Number(value) : value;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new BitLiteError(`${label} requires a port number between 1 and 65535`);
  }
  return port;
}

/**
 * Whether this failure, or anything it wraps, says the port is taken. Some
 * servers report `EADDRINUSE` directly and others bury it in a cause chain
 * behind a message of their own, and a caller looking for a free port wants
 * the same answer either way.
 */
export function isPortUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ("code" in error && error.code === "EADDRINUSE") return true;
  if (/port \d+ is already in use/i.test(error.message)) return true;
  return "cause" in error && isPortUnavailableError(error.cause);
}

/** The file a package manifest's root export resolves to. */
export function readDefaultExport(manifest: Record<string, unknown>, label: string): string {
  const packageExports = manifest.exports;
  if (typeof packageExports === "string") return packageExports;
  if (isRecord(packageExports)) {
    const root = packageExports["."];
    if (typeof root === "string") return root;
    if (isRecord(root)) {
      for (const condition of ["default", "import", "require"]) {
        if (typeof root[condition] === "string") return root[condition];
      }
    }
  }
  if (typeof manifest.main === "string") return manifest.main;
  throw new BitLiteError(`${label} does not define a default package export`);
}

const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const maximumPackageNameLength = 214;

export function isPackageName(value: string): boolean {
  return packageNamePattern.test(value) && value.length <= maximumPackageNameLength;
}

export function readPackageName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BitLiteError(`${label} must be a non-empty string`);
  }
  if (!isPackageName(value)) {
    throw new BitLiteError(`${label} must be a valid npm package name`);
  }
  return value;
}

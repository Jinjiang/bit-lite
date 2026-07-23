export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

export function sortStringRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  );
}

export type JsonNumberPolicy = "finite" | "allow-non-finite";

export type JsonValidationOptions = {
  numberPolicy?: JsonNumberPolicy;
};

export function isJsonValue(
  value: unknown,
  options: JsonValidationOptions = {}
): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") {
    return options.numberPolicy === "allow-non-finite" || Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, options));
  }
  return isJsonObject(value, options);
}

export function isJsonObject(
  value: unknown,
  options: JsonValidationOptions = {}
): value is JsonObject {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => isJsonValue(item, options))
  );
}

export function sanitizeFileName(value: string, fallback = "env"): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

export function isFileUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "file:";
  } catch {
    return false;
  }
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

export type CombinedErrorPolicy = "retain-duplicates" | "deduplicate";

export function throwCombinedErrors(
  errors: readonly unknown[],
  message: string,
  policy: CombinedErrorPolicy = "retain-duplicates"
): void {
  const selectedErrors = policy === "deduplicate" ? [...new Set(errors)] : [...errors];
  if (selectedErrors.length === 0) return;
  if (selectedErrors.length === 1) throw selectedErrors[0];
  throw new AggregateError(selectedErrors, message);
}

export type ErrorFormatPolicy =
  | "message-only"
  | "stack-preferred"
  | "object-message-aware";

export function formatError(
  error: unknown,
  policy: ErrorFormatPolicy = "message-only"
): string {
  if (error instanceof Error) {
    return policy === "message-only" ? error.message : error.stack ?? error.message;
  }
  if (policy === "object-message-aware" && isRecord(error) && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

export type ReadHostOptions = {
  fallback: string;
  createError: (value: unknown) => Error;
};

export function readHost(value: unknown, options: ReadHostOptions): string {
  if (value === undefined) return options.fallback;
  if (typeof value !== "string" || value.length === 0) {
    throw options.createError(value);
  }
  return value;
}

export type ReadPortOptions = {
  fallback?: number;
  acceptNumericString?: boolean;
  minimum?: number;
  maximum?: number;
  createError: (value: unknown) => Error;
};

export function readPort(value: unknown, options: ReadPortOptions): number {
  if (value === undefined && options.fallback !== undefined) return options.fallback;
  const port =
    typeof value === "number"
      ? value
      : options.acceptNumericString === true && typeof value === "string"
        ? Number(value)
        : Number.NaN;
  const minimum = options.minimum ?? 1;
  const maximum = options.maximum ?? 65_535;
  if (!Number.isInteger(port) || port < minimum || port > maximum) {
    throw options.createError(value);
  }
  return port;
}

export type PortUnavailableErrorPolicy = "code-only" | "recursive";

export function isPortUnavailableError(
  error: unknown,
  policy: PortUnavailableErrorPolicy = "code-only"
): boolean {
  if (!(error instanceof Error)) return false;
  if ("code" in error && error.code === "EADDRINUSE") return true;
  if (policy === "code-only") return false;
  if (/port \d+ is already in use/i.test(error.message)) return true;
  return "cause" in error && isPortUnavailableError(error.cause, policy);
}

export type ReadDefaultExportOptions = {
  conditions?: readonly string[];
  createMissingExportError: () => Error;
};

export function readDefaultExport(
  manifest: Record<string, unknown>,
  options: ReadDefaultExportOptions
): string {
  const packageExports = manifest.exports;
  if (typeof packageExports === "string") return packageExports;
  if (isRecord(packageExports)) {
    const root = packageExports["."];
    if (typeof root === "string") return root;
    if (isRecord(root)) {
      for (const condition of options.conditions ?? ["default", "import", "require"]) {
        if (typeof root[condition] === "string") return root[condition];
      }
    }
  }
  if (typeof manifest.main === "string") return manifest.main;
  throw options.createMissingExportError();
}

export type PackageNameErrorReason = "required-string" | "invalid-package-name";

export type ReadPackageNameOptions = {
  invalidTypeReason?: PackageNameErrorReason;
  createError: (reason: PackageNameErrorReason, value: unknown) => Error;
  pattern?: RegExp;
  maximumLength?: number;
};

const defaultPackageNamePattern =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function readPackageName(
  value: unknown,
  options: ReadPackageNameOptions
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw options.createError(
      options.invalidTypeReason ?? "invalid-package-name",
      value
    );
  }
  const pattern = options.pattern ?? defaultPackageNamePattern;
  if (!pattern.test(value) || value.length > (options.maximumLength ?? 214)) {
    throw options.createError("invalid-package-name", value);
  }
  return value;
}

import type {
  JsonObject,
  JsonValue,
  VendorData,
  VendorDefinition,
  VendorRuntime,
  VendorStartResult,
} from "bit-lite-vendors";

export type CompileVendorRuntime = JsonObject & {
  mainFileRelative: string;
  distDir: string;
};

export type CompileVendorInput = VendorData<JsonObject, CompileVendorRuntime>;
export type CompileOutput = JsonObject | undefined;

export type CompileRunResult = JsonObject & {
  output: JsonObject | null;
};

export type CompileWatchResult = JsonObject & {
  run: number;
  output: JsonObject | null;
};

export type CompilerVendorRuntime = VendorRuntime<
  JsonObject,
  CompileWatchResult,
  never,
  CompileVendorRuntime
>;

export type CompilerVendorStart = (
  runtime: CompilerVendorRuntime
) => void | VendorStartResult<CompileRunResult> |
  Promise<void | VendorStartResult<CompileRunResult>>;

export type CompilerVendorModule = {
  meta: VendorDefinition;
  default: CompilerVendorStart;
};

export function isCompilerVendorModule(value: unknown): value is CompilerVendorModule {
  return isRecord(value) && isVendorDefinition(value.meta) && typeof value.default === "function";
}

export function isCompileRunResult(value: unknown): value is CompileRunResult {
  return isJsonObject(value) && (value.output === null || isJsonObject(value.output));
}

export function isCompileWatchResult(value: unknown): value is CompileWatchResult {
  return isJsonObject(value) && typeof value.run === "number" && Number.isInteger(value.run) && value.run > 0 &&
    (value.output === null || isJsonObject(value.output));
}

function isVendorDefinition(value: unknown): value is VendorDefinition {
  return isRecord(value) && typeof value.id === "string" && typeof value.label === "string" &&
    typeof value.hint === "string" && (typeof value.moduleUrl === "string" || value.moduleUrl instanceof URL);
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

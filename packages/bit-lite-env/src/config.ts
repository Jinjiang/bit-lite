import { supportedEnvServiceNames } from "./types/index.js";
import type {
  EnvConfig,
  EnvServiceDefinitionMap,
  EnvServicesDefinition,
  JsonObject,
  ServiceTargetInput,
  SupportedEnvServiceName,
  TestServiceConfig,
} from "./types/index.js";

export class BitLiteEnvConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BitLiteEnvConfigError";
  }
}

export function isSupportedEnvServiceName(value: string): value is SupportedEnvServiceName {
  return supportedEnvServiceNames.includes(value as SupportedEnvServiceName);
}

export function validateEnvConfig(value: unknown): EnvConfig {
  if (!isRecord(value)) throw new BitLiteEnvConfigError("env config must be an object");

  const parent = value.extends;
  const services = value.services;

  if (parent !== undefined && typeof parent !== "string") {
    throw new BitLiteEnvConfigError('env config field "extends" must be a string');
  }

  return {
    ...(parent ? { extends: parent } : {}),
    services: services === undefined ? {} : validateEnvServicesConfig(services),
  };
}

export function validateEnvServicesConfig(value: unknown): EnvServicesDefinition {
  if (!isRecord(value)) throw new BitLiteEnvConfigError('env config field "services" must be an object');

  const services: EnvServicesDefinition = {};
  for (const [serviceName, serviceConfig] of Object.entries(value)) {
    if (!isSupportedEnvServiceName(serviceName)) {
      throw new BitLiteEnvConfigError(
        `env service "${serviceName}" is not supported; expected one of ${supportedEnvServiceNames.join(", ")}`
      );
    }

    services[serviceName] = validateEnvServiceConfig(
      serviceName,
      serviceConfig
    ) as EnvServiceDefinitionMap[typeof serviceName];
  }

  return services;
}

export function validateEnvServiceConfig<ServiceName extends SupportedEnvServiceName>(
  serviceName: ServiceName,
  value: unknown
): EnvServiceDefinitionMap[ServiceName] {
  if (!isRecord(value)) {
    throw new BitLiteEnvConfigError(`env service "${serviceName}" config must be an object`);
  }

  if (typeof value.vendor !== "string" || value.vendor.length === 0) {
    throw new BitLiteEnvConfigError(`env service "${serviceName}" config must define a non-empty vendor`);
  }

  const config = value.config === undefined ? undefined : validateServiceOptions(serviceName, value.config);
  const targets = value.targets === undefined ? undefined : validateServiceTargets(serviceName, value.targets);

  return {
    vendor: value.vendor,
    ...(config ? { config } : {}),
    ...(targets ? { targets } : {}),
  } as EnvServiceDefinitionMap[ServiceName];
}

function validateServiceOptions(
  serviceName: SupportedEnvServiceName,
  value: unknown
): TestServiceConfig {
  if (!isJsonObject(value)) {
    throw new BitLiteEnvConfigError(`env service "${serviceName}" field "config" must be a JSON object`);
  }

  requireOptionalString(value, serviceName, "configFile");
  requireOptionalString(value, serviceName, "shard");
  requireOptionalInteger(value, serviceName, "retries");
  requireOptionalBoolean(value, serviceName, "coverage");
  return value as TestServiceConfig;
}

function validateServiceTargets(serviceName: SupportedEnvServiceName, value: unknown): ServiceTargetInput {
  if (!isRecord(value)) {
    throw new BitLiteEnvConfigError(`env service "${serviceName}" field "targets" must be an object`);
  }
  rejectUnknownFields(value, ["files", "patterns"], `env service "${serviceName}" field "targets"`);

  const targets: ServiceTargetInput = {};
  if (value.files !== undefined) {
    targets.files = readStringArray(value.files, `env service "${serviceName}" field "targets.files"`);
  }
  if (value.patterns !== undefined) {
    if (!Array.isArray(value.patterns)) {
      throw new BitLiteEnvConfigError(`env service "${serviceName}" field "targets.patterns" must be an array`);
    }
    targets.patterns = value.patterns.map((pattern, index) => validateTargetPattern(serviceName, pattern, index));
  }
  return targets;
}

function validateTargetPattern(serviceName: SupportedEnvServiceName, value: unknown, index: number) {
  const prefix = `env service "${serviceName}" field "targets.patterns[${index}]"`;
  if (!isRecord(value)) throw new BitLiteEnvConfigError(`${prefix} must be an object`);
  rejectUnknownFields(value, ["include", "exclude"], prefix);

  const pattern = {};
  if (value.include !== undefined) {
    Object.assign(pattern, { include: readStringArray(value.include, `${prefix}.include`) });
  }
  if (value.exclude !== undefined) {
    Object.assign(pattern, { exclude: readStringArray(value.exclude, `${prefix}.exclude`) });
  }
  return pattern;
}

function requireOptionalString(value: JsonObject, serviceName: SupportedEnvServiceName, field: string) {
  const item = value[field];
  if (item !== undefined && typeof item !== "string") {
    throw new BitLiteEnvConfigError(`env service "${serviceName}" field "config.${field}" must be a string`);
  }
}

function requireOptionalBoolean(value: JsonObject, serviceName: SupportedEnvServiceName, field: string) {
  const item = value[field];
  if (item !== undefined && typeof item !== "boolean") {
    throw new BitLiteEnvConfigError(`env service "${serviceName}" field "config.${field}" must be a boolean`);
  }
}

function requireOptionalInteger(value: JsonObject, serviceName: SupportedEnvServiceName, field: string) {
  const item = value[field];
  if (item !== undefined && (typeof item !== "number" || !Number.isInteger(item) || item < 0)) {
    throw new BitLiteEnvConfigError(`env service "${serviceName}" field "config.${field}" must be a non-negative integer`);
  }
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new BitLiteEnvConfigError(`${label} must be an array of strings`);
  }
  return [...value];
}

function rejectUnknownFields(value: Record<string, unknown>, knownFields: string[], label: string) {
  for (const field of Object.keys(value)) {
    if (!knownFields.includes(field)) {
      throw new BitLiteEnvConfigError(`${label}.${field} is not supported`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonObject[keyof JsonObject] {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

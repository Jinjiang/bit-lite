import { supportedEnvServiceNames } from "./types/index.js";
import type {
  EnvDefinition,
  EnvServiceConfigMap,
  EnvServicesConfig,
  JsonObject,
  JsonValue,
  PreviewServiceConfig,
  SupportedEnvServiceName,
  TestServiceConfig,
} from "./types/index.js";

const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export class BitLiteEnvConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BitLiteEnvConfigError";
  }
}

export function isSupportedEnvServiceName(value: string): value is SupportedEnvServiceName {
  return supportedEnvServiceNames.includes(value as SupportedEnvServiceName);
}

export function validateEnvDefinition(value: unknown, expectedPackageName?: string): EnvDefinition {
  if (!isRecord(value)) throw new BitLiteEnvConfigError("env definition must be an object");
  rejectUnknownFields(value, ["name", "extends", "services", "config"], "env definition");

  const name = readPackageName(value.name, 'env definition field "name"');
  if (expectedPackageName !== undefined && name !== expectedPackageName) {
    throw new BitLiteEnvConfigError(
      `env definition name mismatch: expected "${expectedPackageName}" but received "${name}"`
    );
  }

  const parent = value.extends === undefined
    ? undefined
    : readPackageName(value.extends, 'env definition field "extends"');
  if (value.services === undefined) {
    throw new BitLiteEnvConfigError('env definition field "services" must be an object');
  }

  const services = validateEnvServicesConfig(value.services);
  const config = value.config === undefined
    ? undefined
    : validateJsonObject(value.config, 'env definition field "config"');

  return {
    name,
    ...(parent ? { extends: parent } : {}),
    services,
    ...(config ? { config } : {}),
  };
}

export function validateEnvServicesConfig(value: unknown): EnvServicesConfig {
  if (!isRecord(value)) throw new BitLiteEnvConfigError('env definition field "services" must be an object');

  const services: EnvServicesConfig = {};
  for (const [serviceName, serviceConfig] of Object.entries(value)) {
    if (!isSupportedEnvServiceName(serviceName)) {
      throw new BitLiteEnvConfigError(
        `env service "${serviceName}" is not supported; expected one of ${supportedEnvServiceNames.join(", ")}`
      );
    }

    switch (serviceName) {
      case "test":
        services.test = validateEnvServiceConfig(serviceName, serviceConfig);
        break;
      case "preview":
        services.preview = validateEnvServiceConfig(serviceName, serviceConfig);
        break;
      case "compile":
        services.compile = validateEnvServiceConfig(serviceName, serviceConfig);
        break;
    }
  }
  return services;
}

export function validateEnvServiceConfig<ServiceName extends SupportedEnvServiceName>(
  serviceName: ServiceName,
  value: unknown
): EnvServiceConfigMap[ServiceName] {
  if (!isRecord(value)) {
    throw new BitLiteEnvConfigError(`env service "${serviceName}" must be an object`);
  }
  rejectUnknownFields(value, ["vendor", "config"], `env service "${serviceName}"`);

  if (typeof value.vendor !== "string" || value.vendor.trim().length === 0) {
    throw new BitLiteEnvConfigError(`env service "${serviceName}" must define a non-empty vendor`);
  }
  if (serviceName === "preview" && value.config === undefined) {
    throw new BitLiteEnvConfigError(`env service "${serviceName}" must define field "config"`);
  }

  const config = value.config === undefined
    ? undefined
    : validateServiceOptions(serviceName, value.config);
  return {
    vendor: value.vendor,
    ...(config ? { config } : {}),
  } as EnvServiceConfigMap[ServiceName];
}

function validateServiceOptions(
  serviceName: SupportedEnvServiceName,
  value: unknown
): JsonObject {
  const config = validateJsonObject(value, `env service "${serviceName}" field "config"`);
  switch (serviceName) {
    case "test":
      requireOptionalString(config, serviceName, "configFile");
      requireOptionalString(config, serviceName, "shard");
      requireOptionalInteger(config, serviceName, "retries");
      requireOptionalBoolean(config, serviceName, "coverage");
      return config as TestServiceConfig;
    case "preview":
      requireString(config, serviceName, "configFile");
      requireOptionalNonEmptyString(config, serviceName, "mounter");
      requireOptionalNonEmptyString(config, serviceName, "docsTemplate");
      return config as PreviewServiceConfig;
    case "compile":
      return config;
  }
}

function validateJsonObject(value: unknown, label: string): JsonObject {
  if (!isRecord(value)) throw new BitLiteEnvConfigError(`${label} must be a JSON object`);
  validateJsonValue(value, label, new Set<object>());
  return value as JsonObject;
}

function validateJsonValue(value: unknown, label: string, stack: Set<object>): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new BitLiteEnvConfigError(`${label} must contain only finite numbers`);
    return;
  }
  if (typeof value !== "object") {
    throw new BitLiteEnvConfigError(`${label} must be recursively JSON-safe`);
  }
  if (stack.has(value)) throw new BitLiteEnvConfigError(`${label} must not contain circular values`);
  stack.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonValue(item, `${label}[${index}]`, stack));
  } else {
    for (const [key, item] of Object.entries(value)) {
      validateJsonValue(item, `${label}.${key}`, stack);
    }
  }
  stack.delete(value);
}

function readPackageName(value: unknown, label: string) {
  if (typeof value !== "string" || !packageNamePattern.test(value) || value.length > 214) {
    throw new BitLiteEnvConfigError(`${label} must be a valid npm package name`);
  }
  return value;
}

function requireString(value: JsonObject, serviceName: string, field: string) {
  if (typeof value[field] !== "string" || value[field].length === 0) {
    throw new BitLiteEnvConfigError(
      `env service "${serviceName}" field "config.${field}" must be a non-empty string`
    );
  }
}

function requireOptionalString(value: JsonObject, serviceName: string, field: string) {
  if (value[field] !== undefined && typeof value[field] !== "string") {
    throw new BitLiteEnvConfigError(`env service "${serviceName}" field "config.${field}" must be a string`);
  }
}

function requireOptionalNonEmptyString(value: JsonObject, serviceName: string, field: string) {
  if (value[field] !== undefined) requireString(value, serviceName, field);
}

function requireOptionalBoolean(value: JsonObject, serviceName: string, field: string) {
  if (value[field] !== undefined && typeof value[field] !== "boolean") {
    throw new BitLiteEnvConfigError(`env service "${serviceName}" field "config.${field}" must be a boolean`);
  }
}

function requireOptionalInteger(value: JsonObject, serviceName: string, field: string) {
  if (value[field] !== undefined && (!Number.isInteger(value[field]) || (value[field] as number) < 0)) {
    throw new BitLiteEnvConfigError(
      `env service "${serviceName}" field "config.${field}" must be a non-negative integer`
    );
  }
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: string[], label: string) {
  const allowedSet = new Set(allowed);
  for (const field of Object.keys(value)) {
    if (!allowedSet.has(field)) throw new BitLiteEnvConfigError(`${label} field "${field}" is not supported`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { isRecord, readPackageName } from "bit-lite-utils";
import { supportedEnvServiceNames } from "./types/index.js";
import type {
  CompiledEnvDefinition,
  CompiledEnvServiceOrigin,
  EnvDefinition,
  EnvServiceConfigMap,
  EnvServicesConfig,
  JsonObject,
  JsonValue,
  PreviewServiceConfig,
  SupportedEnvServiceName,
  TestServiceConfig,
} from "./types/index.js";
import { compiledEnvFormatVersion } from "./types/index.js";

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

  const name = readEnvPackageName(value.name, 'env definition field "name"');
  if (expectedPackageName !== undefined && name !== expectedPackageName) {
    throw new BitLiteEnvConfigError(
      `env definition name mismatch: expected "${expectedPackageName}" but received "${name}"`
    );
  }

  const parent = value.extends === undefined
    ? undefined
    : readEnvPackageName(value.extends, 'env definition field "extends"');
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

export function isCompiledEnvDefinition(value: unknown): value is CompiledEnvDefinition {
  return isRecord(value) && value.formatVersion !== undefined;
}

export function validateCompiledEnvDefinition(
  value: unknown,
  expectedPackageName?: string
): CompiledEnvDefinition {
  if (!isRecord(value)) throw new BitLiteEnvConfigError("compiled env definition must be an object");
  rejectUnknownFields(
    value,
    ["formatVersion", "name", "services", "config", "inheritance", "serviceOrigins"],
    "compiled env definition"
  );
  if (value.formatVersion !== compiledEnvFormatVersion) {
    throw new BitLiteEnvConfigError(
      `compiled env format version must be ${compiledEnvFormatVersion}; received ${String(value.formatVersion)}`
    );
  }
  const name = readEnvPackageName(value.name, 'compiled env definition field "name"');
  if (expectedPackageName !== undefined && name !== expectedPackageName) {
    throw new BitLiteEnvConfigError(
      `env definition name mismatch: expected "${expectedPackageName}" but received "${name}"`
    );
  }
  const services = validateEnvServicesConfig(value.services);
  const config = value.config === undefined
    ? undefined
    : validateJsonObject(value.config, 'compiled env definition field "config"');
  const inheritance = readPackageNameArray(
    value.inheritance,
    'compiled env definition field "inheritance"'
  );
  if (inheritance.length === 0 || inheritance.at(-1) !== name) {
    throw new BitLiteEnvConfigError(
      `compiled env definition inheritance must end with selected env "${name}"`
    );
  }
  if (!isRecord(value.serviceOrigins)) {
    throw new BitLiteEnvConfigError('compiled env definition field "serviceOrigins" must be an object');
  }
  const serviceOrigins: CompiledEnvDefinition["serviceOrigins"] = {};
  for (const [serviceName, origin] of Object.entries(value.serviceOrigins)) {
    if (!isSupportedEnvServiceName(serviceName) || services[serviceName] === undefined) {
      throw new BitLiteEnvConfigError(
        `compiled env service origin "${serviceName}" does not match a configured service`
      );
    }
    serviceOrigins[serviceName] = validateCompiledServiceOrigin(serviceName, origin);
  }
  for (const serviceName of Object.keys(services) as SupportedEnvServiceName[]) {
    if (serviceOrigins[serviceName] === undefined) {
      throw new BitLiteEnvConfigError(`compiled env service "${serviceName}" must define an origin`);
    }
  }

  return {
    formatVersion: compiledEnvFormatVersion,
    name,
    services,
    ...(config ? { config } : {}),
    inheritance,
    serviceOrigins,
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

function readEnvPackageName(value: unknown, label: string) {
  return readPackageName(value, {
    createError: () =>
      new BitLiteEnvConfigError(`${label} must be a valid npm package name`),
  });
}

function readPackageNameArray(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new BitLiteEnvConfigError(`${label} must be an array`);
  return value.map((item, index) =>
    readEnvPackageName(item, `${label}[${index}]`)
  );
}

function validateCompiledServiceOrigin(
  serviceName: string,
  value: unknown
): CompiledEnvServiceOrigin {
  if (!isRecord(value)) {
    throw new BitLiteEnvConfigError(`compiled env service origin "${serviceName}" must be an object`);
  }
  rejectUnknownFields(value, ["dependencyPath"], `compiled env service origin "${serviceName}"`);
  return {
    dependencyPath: readPackageNameArray(
      value.dependencyPath,
      `compiled env service origin "${serviceName}" field "dependencyPath"`
    ),
  };
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

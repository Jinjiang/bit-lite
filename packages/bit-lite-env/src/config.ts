import { BitLiteError, isRecord, readPackageName } from "bit-lite-utils";
import { compiledEnvFormatVersion, supportedEnvServiceNames } from "./types/index.js";
import type {
  CompiledEnvDefinition,
  CompiledEnvServiceOrigin,
  EnvDefinition,
  EnvServiceConfigMap,
  EnvServicesConfig,
  JsonObject,
  SupportedEnvServiceName,
} from "./types/index.js";

export function isSupportedEnvServiceName(value: string): value is SupportedEnvServiceName {
  return supportedEnvServiceNames.includes(value as SupportedEnvServiceName);
}

export function validateEnvDefinition(value: unknown, expectedPackageName?: string): EnvDefinition {
  const record = readObject(value, "env definition");
  rejectUnknownFields(record, ["name", "extends", "services", "config"], "env definition");

  const name = readEnvName(record.name, 'env definition field "name"', expectedPackageName);
  const parent = record.extends === undefined
    ? undefined
    : readPackageName(record.extends, 'env definition field "extends"');
  if (record.services === undefined) {
    throw new BitLiteError('env definition field "services" must be an object');
  }

  const services = validateEnvServicesConfig(record.services);
  const config = record.config === undefined
    ? undefined
    : validateJsonObject(record.config, 'env definition field "config"');

  return {
    name,
    ...(parent ? { extends: parent } : {}),
    services,
    ...(config ? { config } : {}),
  };
}

/**
 * Tells a compiled env from a source one by the only field a source definition
 * never has. Loading depends on the distinction: a source definition still
 * needs its inheritance resolved, a compiled one is ready to read.
 */
export function isCompiledEnvDefinition(value: unknown): value is CompiledEnvDefinition {
  return isRecord(value) && value.formatVersion !== undefined;
}

export function validateCompiledEnvDefinition(
  value: unknown,
  expectedPackageName?: string
): CompiledEnvDefinition {
  const record = readObject(value, "compiled env definition");
  rejectUnknownFields(
    record,
    ["formatVersion", "name", "services", "config", "inheritance", "serviceOrigins"],
    "compiled env definition"
  );
  if (record.formatVersion !== compiledEnvFormatVersion) {
    throw new BitLiteError(
      `compiled env format version must be ${compiledEnvFormatVersion}; received ${String(record.formatVersion)}`
    );
  }

  const name = readEnvName(
    record.name,
    'compiled env definition field "name"',
    expectedPackageName
  );
  const services = validateEnvServicesConfig(record.services);
  const config = record.config === undefined
    ? undefined
    : validateJsonObject(record.config, 'compiled env definition field "config"');

  const inheritance = readPackageNameArray(
    record.inheritance,
    'compiled env definition field "inheritance"'
  );
  if (inheritance.at(-1) !== name) {
    throw new BitLiteError(
      `compiled env definition inheritance must end with selected env "${name}"`
    );
  }

  return {
    formatVersion: compiledEnvFormatVersion,
    name,
    services,
    ...(config ? { config } : {}),
    inheritance,
    serviceOrigins: validateServiceOrigins(record.serviceOrigins, services),
  };
}

export function validateEnvServicesConfig(value: unknown): EnvServicesConfig {
  const record = readObject(value, 'env definition field "services"');

  const services: EnvServicesConfig = {};
  for (const [serviceName, serviceConfig] of Object.entries(record)) {
    if (!isSupportedEnvServiceName(serviceName)) {
      throw new BitLiteError(
        `env service "${serviceName}" is not supported; expected one of ${supportedEnvServiceNames.join(", ")}`
      );
    }
    // One assignment for every service: the map's value type is keyed by the
    // same name the validator is given, which no per-service branch can state
    // any better.
    (services as Record<SupportedEnvServiceName, EnvServiceConfigMap[SupportedEnvServiceName]>)[
      serviceName
    ] = validateEnvServiceConfig(serviceName, serviceConfig);
  }
  return services;
}

export function validateEnvServiceConfig<ServiceName extends SupportedEnvServiceName>(
  serviceName: ServiceName,
  value: unknown
): EnvServiceConfigMap[ServiceName] {
  const record = readObject(value, `env service "${serviceName}"`);
  rejectUnknownFields(record, ["vendor", "config"], `env service "${serviceName}"`);

  if (typeof record.vendor !== "string" || record.vendor.trim().length === 0) {
    throw new BitLiteError(`env service "${serviceName}" must define a non-empty vendor`);
  }
  if (serviceName === "preview" && record.config === undefined) {
    throw new BitLiteError(`env service "${serviceName}" must define field "config"`);
  }

  const config = record.config === undefined
    ? undefined
    : validateServiceOptions(serviceName, record.config);
  return {
    vendor: record.vendor,
    ...(config ? { config } : {}),
  } as EnvServiceConfigMap[ServiceName];
}

/**
 * The fields Bit Lite reads out of a service's configuration. Everything else
 * is passed to the vendor untouched, so only these are constrained.
 */
function validateServiceOptions(serviceName: SupportedEnvServiceName, value: unknown): JsonObject {
  const config = validateJsonObject(value, `env service "${serviceName}" field "config"`);
  const field = (name: string) => `env service "${serviceName}" field "config.${name}"`;

  switch (serviceName) {
    case "test":
      expectType(config.configFile, "string", field("configFile"), { optional: true });
      expectType(config.shard, "string", field("shard"), { optional: true });
      expectNonNegativeInteger(config.retries, field("retries"));
      expectType(config.coverage, "boolean", field("coverage"), { optional: true });
      return config;
    case "preview":
      expectNonEmptyString(config.configFile, field("configFile"));
      if (config.mounter !== undefined) expectNonEmptyString(config.mounter, field("mounter"));
      if (config.docsTemplate !== undefined) {
        expectNonEmptyString(config.docsTemplate, field("docsTemplate"));
      }
      return config;
    case "compile":
      return config;
  }
}

function validateServiceOrigins(
  value: unknown,
  services: EnvServicesConfig
): CompiledEnvDefinition["serviceOrigins"] {
  const record = readObject(value, 'compiled env definition field "serviceOrigins"');
  const origins: CompiledEnvDefinition["serviceOrigins"] = {};

  for (const [serviceName, origin] of Object.entries(record)) {
    if (!isSupportedEnvServiceName(serviceName) || services[serviceName] === undefined) {
      throw new BitLiteError(
        `compiled env service origin "${serviceName}" does not match a configured service`
      );
    }
    origins[serviceName] = validateServiceOrigin(serviceName, origin);
  }
  for (const serviceName of Object.keys(services) as SupportedEnvServiceName[]) {
    if (origins[serviceName] === undefined) {
      throw new BitLiteError(`compiled env service "${serviceName}" must define an origin`);
    }
  }
  return origins;
}

function validateServiceOrigin(serviceName: string, value: unknown): CompiledEnvServiceOrigin {
  const label = `compiled env service origin "${serviceName}"`;
  const record = readObject(value, label);
  rejectUnknownFields(record, ["dependencyPath"], label);
  return {
    dependencyPath: readPackageNameArray(record.dependencyPath, `${label} field "dependencyPath"`),
  };
}

/**
 * A JSON object with no cycles and no non-finite numbers, so writing it back
 * out cannot fail or silently change what it says.
 */
function validateJsonObject(value: unknown, label: string): JsonObject {
  readObject(value, label);
  validateJsonValue(value, label, new Set<object>());
  return value as JsonObject;
}

function validateJsonValue(value: unknown, label: string, seen: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new BitLiteError(`${label} must contain only finite numbers`);
    return;
  }
  if (typeof value !== "object") {
    throw new BitLiteError(`${label} must be recursively JSON-safe`);
  }
  if (seen.has(value)) throw new BitLiteError(`${label} must not contain circular values`);
  seen.add(value);
  const entries = Array.isArray(value)
    ? value.map((item, index) => [`${label}[${index}]`, item] as const)
    : Object.entries(value).map(([key, item]) => [`${label}.${key}`, item] as const);
  for (const [itemLabel, item] of entries) validateJsonValue(item, itemLabel, seen);
  seen.delete(value);
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new BitLiteError(`${label} must be an object`);
  return value;
}

function readEnvName(value: unknown, label: string, expectedPackageName: string | undefined) {
  const name = readPackageName(value, label);
  if (expectedPackageName !== undefined && name !== expectedPackageName) {
    throw new BitLiteError(
      `env definition name mismatch: expected "${expectedPackageName}" but received "${name}"`
    );
  }
  return name;
}

function readPackageNameArray(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new BitLiteError(`${label} must be an array`);
  return value.map((item, index) => readPackageName(item, `${label}[${index}]`));
}

function expectType(
  value: unknown,
  type: "string" | "boolean",
  label: string,
  options: { optional?: boolean } = {}
) {
  if (options.optional === true && value === undefined) return;
  if (typeof value !== type) throw new BitLiteError(`${label} must be a ${type}`);
}

function expectNonEmptyString(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new BitLiteError(`${label} must be a non-empty string`);
  }
}

function expectNonNegativeInteger(value: unknown, label: string) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new BitLiteError(`${label} must be a non-negative integer`);
  }
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: string[], label: string) {
  const allowedSet = new Set(allowed);
  for (const field of Object.keys(value)) {
    if (!allowedSet.has(field)) throw new BitLiteError(`${label} field "${field}" is not supported`);
  }
}

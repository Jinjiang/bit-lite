import { compiledEnvFormatVersion } from "./types/index.js";
import type {
  CompiledEnvDefinition,
  EnvServicesConfig,
  JsonObject,
  SourceEnvDefinition,
  SupportedEnvServiceName,
} from "./types/index.js";

/** Flatten one validated source definition over an optional already-flattened parent. */
export function flattenEnvDefinition(
  definition: SourceEnvDefinition,
  parent?: CompiledEnvDefinition
): CompiledEnvDefinition {
  if (definition.extends === undefined && parent !== undefined) {
    throw new Error(`env "${definition.name}" received a parent without declaring extends`);
  }
  if (definition.extends !== undefined && parent?.name !== definition.extends) {
    throw new Error(
      `env "${definition.name}" extends "${definition.extends}" but parent is "${parent?.name ?? "missing"}"`
    );
  }

  const services: EnvServicesConfig = {
    ...(parent?.services ?? {}),
    ...definition.services,
  };
  const serviceOrigins: CompiledEnvDefinition["serviceOrigins"] = {};
  if (parent && definition.extends) {
    for (const serviceName of Object.keys(parent.services) as SupportedEnvServiceName[]) {
      const origin = parent.serviceOrigins[serviceName];
      if (!origin) throw new Error(`parent env "${parent.name}" is missing origin for service "${serviceName}"`);
      serviceOrigins[serviceName] = {
        dependencyPath: [definition.extends, ...origin.dependencyPath],
      };
    }
  }
  for (const serviceName of Object.keys(definition.services) as SupportedEnvServiceName[]) {
    serviceOrigins[serviceName] = { dependencyPath: [] };
  }

  const config = mergeConfig(parent?.config, definition.config);
  return {
    formatVersion: compiledEnvFormatVersion,
    name: definition.name,
    services,
    ...(config ? { config } : {}),
    inheritance: [...(parent?.inheritance ?? []), definition.name],
    serviceOrigins,
  };
}

function mergeConfig(parent: JsonObject | undefined, own: JsonObject | undefined) {
  return parent || own ? { ...(parent ?? {}), ...(own ?? {}) } : undefined;
}

import type { JsonObject } from "bit-lite-utils";

export type { JsonObject, JsonPrimitive, JsonValue } from "bit-lite-utils";

export const supportedEnvServiceNames = ["test", "preview", "compile"] as const;

export type SupportedEnvServiceName = (typeof supportedEnvServiceNames)[number];

export type EnvServiceConfig<Config extends JsonObject = JsonObject> = {
  vendor: string;
  config?: Config;
};

export type TestServiceConfig = JsonObject & {
  configFile?: string;
  shard?: string;
  retries?: number;
  coverage?: boolean;
};

export type PreviewServiceConfig = JsonObject & {
  configFile: string;
  mounter?: string;
  docsTemplate?: string;
};

export type CompileServiceConfig = JsonObject;

export type EnvServiceConfigMap = {
  test: EnvServiceConfig<TestServiceConfig>;
  preview: EnvServiceConfig<PreviewServiceConfig>;
  compile: EnvServiceConfig<CompileServiceConfig>;
};

export type EnvServicesConfig = Partial<EnvServiceConfigMap>;

/**
 * An env as its author writes it: one `extends` link and the services it adds
 * or replaces. Compiling resolves the chain into the flattened form below.
 */
export type EnvDefinition = {
  name: string;
  extends?: string;
  services: EnvServicesConfig;
  config?: JsonObject;
};

export const compiledEnvFormatVersion = 1 as const;

export type CompiledEnvServiceOrigin = {
  /** Package dependency hops from the selected env package to the service-declaring package. */
  dependencyPath: string[];
};

/**
 * An env after inheritance has been materialized: every service the env offers,
 * with the package that declared it named, so runtime resolution reads static
 * data instead of walking the chain again.
 */
export type CompiledEnvDefinition = {
  formatVersion: typeof compiledEnvFormatVersion;
  name: string;
  services: EnvServicesConfig;
  config?: JsonObject;
  inheritance: string[];
  serviceOrigins: Partial<Record<SupportedEnvServiceName, CompiledEnvServiceOrigin>>;
};

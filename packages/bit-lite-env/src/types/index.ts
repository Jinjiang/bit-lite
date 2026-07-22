export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

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

export type SourceEnvDefinition = {
  name: string;
  extends?: string;
  services: EnvServicesConfig;
  config?: JsonObject;
};

export type EnvDefinition = SourceEnvDefinition;

export const compiledEnvFormatVersion = 1 as const;

export type CompiledEnvServiceOrigin = {
  /** Package dependency hops from the selected env package to the service-declaring package. */
  dependencyPath: string[];
};

export type CompiledEnvDefinition = {
  formatVersion: typeof compiledEnvFormatVersion;
  name: string;
  services: EnvServicesConfig;
  config?: JsonObject;
  inheritance: string[];
  serviceOrigins: Partial<Record<SupportedEnvServiceName, CompiledEnvServiceOrigin>>;
};

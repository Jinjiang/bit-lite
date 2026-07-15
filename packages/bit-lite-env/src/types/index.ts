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

export type EnvDefinition = {
  name: string;
  extends?: string;
  services: EnvServicesConfig;
  config?: JsonObject;
};

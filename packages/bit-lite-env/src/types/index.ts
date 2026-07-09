export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

export const supportedEnvServiceNames = ["test", "preview"] as const;

export type SupportedEnvServiceName = (typeof supportedEnvServiceNames)[number];

export type ServiceTargetPattern = {
  include?: string[];
  exclude?: string[];
};

export type ServiceTargetInput = {
  files?: string[];
  patterns?: ServiceTargetPattern[];
};

export type EnvServiceConfig<Config extends JsonObject = JsonObject> = {
  vendor: string;
  config?: Config;
  targets?: ServiceTargetInput;
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

export type EnvServiceConfigMap = {
  test: EnvServiceConfig<TestServiceConfig>;
  preview: EnvServiceConfig<PreviewServiceConfig>;
};

export type EnvServicesConfig = Partial<EnvServiceConfigMap>;

export type EnvConfig = {
  extends?: string;
  services?: EnvServicesConfig;
};

export type ResolvedEnvConfig = {
  name: string;
  services: EnvServicesConfig;
};

export type EnvFactoryContext = {
  packageName: string;
  version: string;
  envPackageRoot: string;
  workspaceRoot: string;
};

export type EnvDefinition = {
  name: string;
  services: EnvServicesConfig;
  config?: JsonObject;
};

export type EnvFactory = (context: EnvFactoryContext) => EnvDefinition | Promise<EnvDefinition>;

export function defineEnv(definition: EnvDefinition): EnvDefinition {
  return definition;
}

export function defineEnvFactory(factory: EnvFactory): EnvFactory {
  return factory;
}

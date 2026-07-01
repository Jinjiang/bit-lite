// General interface

export type ComponentRef = {
  id: string;
  rootDir: string;
};

// Workspace Config interface

export type EnvConfig = {
  extends?: string;
  // TODO: unknown should be more particularly an optional JSON value
  services?: Record<string, unknown>;
};

export type ResolvedEnvConfig = {
  name: string;
  // TODO: unknown should be more particularly an optional JSON value
  services: Record<string, unknown>;
};

export type WorkspaceConfig = {
  envs: Record<string, EnvConfig>;
  // TODO: should be 1v1 map instead of wildcard patterns
  components?: Record<string, string>;
};

export type ResolvedWorkspaceConfig = {
  envs: Record<string, ResolvedEnvConfig>;
  // TODO: should be 1v1 map instead of wildcard patterns
  components: Record<string, string>;
};

// Runtime interface

export type ComponentRuntime = ComponentRef & {
  envName: string;
};

export type EnvRuntime = {
  envName: string;
  env: ResolvedEnvConfig;
  components: ComponentRef[];
};

export type WorkspaceRuntime = {
  workspaceRoot: string;
  config: ResolvedWorkspaceConfig;
  envs: Record<string, ResolvedEnvConfig>;
  components: ComponentRuntime[];
  groups: EnvRuntime[];
};

// Service Vendor interface

export type ServiceVendorInput<Config = unknown, Args = unknown> = {
  components: ComponentRef[];
  config: Config;
  args: Args;
};

export type ServiceVendorResult<JsonValue = unknown> = {
  status: string;
  toJSON(): JsonValue;
  toString(forTerminal: boolean): string;
};

export type ServiceVendorEventListener = (type: string, payload: unknown) => void;

export type ServiceVendorTask<Result = ServiceVendorResult> = {
  result: Promise<Result>;
  listen(listener: ServiceVendorEventListener): () => void;
  abort(): void;
  call(type: string, payload?: unknown): void;
};

export type ServiceVendor<
  Config = unknown,
  Args = unknown,
  Result extends ServiceVendorResult = ServiceVendorResult,
> = {
  name: string;
  run(input: ServiceVendorInput<Config, Args>, context?: WorkspaceRuntime): ServiceVendorTask<Result>;
};

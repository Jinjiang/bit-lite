// General interface

export type ComponentRef = {
  id: string;
  rootDir: string;
};

// CLI Arguments

export type CliOptionScalar = string | number | boolean;

export type CliOptionValue = CliOptionScalar | CliOptionScalar[];

export type CliArguments = {
  raw: string[];
  positional: string[];
  options: Record<string, CliOptionValue>;
  passthrough: string[];
};

export type ParsedCliArgs = {
  command: string | undefined;
  args: CliArguments;
  workspaceRoot: string;
  help: boolean;
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

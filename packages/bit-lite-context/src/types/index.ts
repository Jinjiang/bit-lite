import type { EnvDefinition, EnvServiceConfig, SupportedEnvServiceName } from "bit-lite-env";

export type ComponentRef = {
  id: string;
  rootDir: string;
  packageName: string;
};

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
  componentFilters: string[];
  help: boolean;
};

export type PackageRef = {
  packageName: string;
  version: string;
};

export type WorkspaceComponentConfig = {
  path: string;
  id: string;
  packageName: string;
  env: PackageRef;
};

export type WorkspaceConfig = {
  defaultScope?: string;
  components: WorkspaceComponentConfig[];
};

export type ComponentKind = "component" | "env";

export type ComponentPackage = ComponentRef & {
  path: string;
  kind: ComponentKind;
  env: PackageRef;
  mainFile: string;
  mainFileRelative: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  internalDependencyPackageNames: string[];
  internalEnvPackageName: string | undefined;
};

export type ComponentPackageRegistry = {
  workspaceRoot: string;
  configPath: string;
  config: WorkspaceConfig;
  components: ComponentPackage[];
  byId: Map<string, ComponentPackage>;
  byPackageName: Map<string, ComponentPackage>;
};

export type LoadedEnvServiceRuntime = {
  definition: EnvServiceConfig;
  declaredBy: string;
  packageRoot: string;
  entryUrl: string;
  entryDirectory: string;
};

export type LoadedEnvRuntime = {
  packageName: string;
  requestedVersion: string;
  installedVersion: string;
  packageRoot: string;
  entryUrl: string;
  entryDirectory: string;
  effectiveDefinition: EnvDefinition;
  services: Partial<Record<SupportedEnvServiceName, LoadedEnvServiceRuntime>>;
  inheritanceChain: string[];
};

export type SelectedEnvIdentity = Pick<
  LoadedEnvRuntime,
  "packageName" | "requestedVersion" | "installedVersion"
>;

export type ComponentRuntime = ComponentRef & {
  kind: ComponentKind;
  envRef: PackageRef;
  env: LoadedEnvRuntime;
};

export type EnvRuntime = {
  env: LoadedEnvRuntime;
  components: ComponentRef[];
};

export type SelectedEnvGroup = EnvRuntime;

export type WorkspaceRuntime = {
  workspaceRoot: string;
  config: WorkspaceConfig;
  envs: Record<string, LoadedEnvRuntime>;
  components: ComponentRuntime[];
  groups: EnvRuntime[];
};

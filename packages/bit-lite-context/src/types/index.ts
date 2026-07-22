import type {
  EnvServiceConfigMap,
  JsonObject,
  SupportedEnvServiceName,
} from "bit-lite-env";

export type CliOptionScalar = string | number | boolean;
export type CliOptionValue = CliOptionScalar | CliOptionScalar[];
export type CliArguments = {
  raw: string[];
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

/** Package requirement from workspace config; `version` may be a range or protocol such as `^1.0.0` or `workspace:*`. */
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

/** Canonical, JSON-safe description of one component in a workspace. */
export type WorkspaceComponent = {
  id: string;
  path: string;
  rootDir: string;
  packageName: string;
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

/** Base workspace snapshot. It never contains loaded env packages or lookup maps. */
export type Workspace = {
  rootDir: string;
  configPath: string;
  config: WorkspaceConfig;
  components: readonly WorkspaceComponent[];
};

/** Resolved package identity; `version` is the concrete version read from the installed package manifest. */
export type PackageIdentity = {
  packageName: string;
  version: string;
};

export type PackageLocation = {
  identity: PackageIdentity;
  rootDir: string;
  entryFile: string;
};

export type SelectedEnvIdentity = {
  packageName: string;
  requestedVersion: string;
  installedVersion: string;
};

export type ResolvedService<Name extends SupportedEnvServiceName = SupportedEnvServiceName> = {
  name: Name;
  definition: EnvServiceConfigMap[Name];
  source: PackageLocation;
};

export type ResolvedServices = {
  [Name in SupportedEnvServiceName]?: ResolvedService<Name>;
};

/** Resolved env information retained only by parent-side orchestration. */
export type EnvContext = {
  env: SelectedEnvIdentity;
  package: PackageLocation;
  config: JsonObject | undefined;
  services: ResolvedServices;
  inheritance: readonly PackageIdentity[];
};

export type ComponentContext = {
  component: WorkspaceComponent;
  env: EnvContext;
};

export type WorkspaceContext = {
  workspace: Workspace;
  components: readonly ComponentContext[];
};

export type WorkspaceEnvGroup = {
  env: EnvContext;
  components: readonly WorkspaceComponent[];
};

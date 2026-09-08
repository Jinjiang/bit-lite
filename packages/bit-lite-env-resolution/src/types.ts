import type {
  EnvServiceConfigMap,
  JsonObject,
  SupportedEnvServiceName,
} from "bit-lite-env";
import type { Workspace, WorkspaceComponent } from "bit-lite-context";

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

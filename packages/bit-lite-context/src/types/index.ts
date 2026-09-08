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
  /**
   * The version this component is currently based on, written back by a
   * recording command. Absent means the component has never been recorded.
   * It lives here rather than in `.comp.json` so it stays outside every
   * captured component tree.
   */
  version?: string;
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
  /** Recorded version anchor from workspace config; `undefined` when never recorded. */
  version: string | undefined;
  mainFile: string;
  mainFileRelative: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  /**
   * The component's parsed `.comp.json` record, exactly as written. The fields
   * above are derived from it; this is kept so a consumer needing the authored
   * form — including fields this model does not interpret — does not parse the
   * same file a second time.
   */
  config: Record<string, unknown>;
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

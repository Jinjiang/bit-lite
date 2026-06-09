export type ServiceResult = {
  ok: boolean;
  message?: string;
};

export type ServiceRunMode = "run" | "watch";

export type ServiceOutputMode = "inherit" | "capture";

export type ServiceReporter = {
  output(chunk: string): void;
};

export type ComponentRef = {
  id: string;
  rootDir: string;
};

export type ServiceContext = {
  workspaceRoot: string;
  envName: string;
  components: ComponentRef[];
  serviceConfig: unknown;
  envServices: Record<string, unknown>;
  mode: ServiceRunMode;
  output: ServiceOutputMode;
  signal: AbortSignal;
  reporter: ServiceReporter;
};

export type BitLiteService = {
  name: string;
  run(context: ServiceContext): Promise<ServiceResult>;
};

export type ServiceFactory = (config: unknown) => BitLiteService;

export type EnvConfig = {
  extends?: string;
  services?: Record<string, unknown>;
};

export type BitLiteConfig = {
  defaultEnv: string;
  envs: Record<string, EnvConfig>;
  components?: Record<string, string>;
};

export type ResolvedEnvConfig = {
  name: string;
  services: Record<string, unknown>;
};

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
  config: BitLiteConfig;
  envs: Record<string, ResolvedEnvConfig>;
  components: ComponentRuntime[];
  groups: EnvRuntime[];
};

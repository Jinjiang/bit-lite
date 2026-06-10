export type ServiceResult = {
  ok: boolean;
  message?: string;
};

export type ComponentRef = {
  id: string;
  rootDir: string;
};

export type ServiceInput<Config = unknown, Args = unknown> = {
  components: ComponentRef[];
  config: Config;
  args: Args;
};

export type ServiceContext = {
  workspaceRoot?: string;
  envName?: string;
  cwd?: string;
};

export type ServiceEventListener = (type: string, payload: unknown) => void;

export type ServiceTask<Result = ServiceResult> = {
  result: Promise<Result>;
  listen(listener: ServiceEventListener): () => void;
  abort(): void;
  call(type: string, payload?: unknown): void;
};

export type BitLiteService<
  Config = unknown,
  Args = unknown,
  Result extends ServiceResult = ServiceResult,
> = {
  name: string;
  run(input: ServiceInput<Config, Args>, context?: ServiceContext): ServiceTask<Result>;
};

export type ServiceFactory = () => BitLiteService;

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

export type ServiceRunResult = {
  envName: string;
  serviceName: string;
  result: ServiceResult;
};

export type ServiceCommandContext = {
  workspace: WorkspaceRuntime;
  serviceName: string;
  args: string[];
};

export type ServiceCommandHandler = {
  run(context: ServiceCommandContext): Promise<ServiceRunResult[]>;
};

export type ServiceDefinition = {
  factory: ServiceFactory;
  command?: ServiceCommandHandler;
};

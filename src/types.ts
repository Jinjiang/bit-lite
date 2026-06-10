export type ServiceResult = {
  ok: boolean;
  message?: string;
};

export type ServiceOutputMode = "inherit" | "capture";

export type ServiceEvent =
  | {
      type: "output";
      stream: "stdout" | "stderr";
      chunk: string;
    }
  | {
      type: "status";
      status: "starting" | "running" | "passed" | "failed" | "stopped";
      message?: string;
    }
  | {
      type: "progress";
      message?: string;
      current?: number;
      total?: number;
    }
  | {
      type: "diagnostic";
      severity: "info" | "warning" | "error";
      message: string;
      file?: string;
      line?: number;
      column?: number;
    }
  | {
      type: "custom";
      name: string;
      data?: unknown;
    };

export type ServiceHost = {
  signal: AbortSignal;
  outputMode: ServiceOutputMode;
  emit(event: ServiceEvent): void;
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
  host: ServiceHost;
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

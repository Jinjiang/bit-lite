export type RunnerMode = "worker" | "inline";

export type RunnerKind = RunnerMode;

export type OutputStream = "stdout" | "stderr";

export type RunnerExitCode = number | null | undefined;

export type Unsubscribe = () => void;

export type ServiceReadyMessage = {
  type: "ready";
  url?: string;
};

export type ServiceStatusMessage = {
  type: "status";
  status: string;
};

export type ServiceErrorMessage = {
  type: "error";
  message: string;
};

export type ServiceMessage = ServiceReadyMessage | ServiceStatusMessage | ServiceErrorMessage;

export type ManagerShutdownMessage = {
  type: "shutdown";
};

export type ManagerMessage = ManagerShutdownMessage;

export type ServiceMessageListener = (message: ServiceMessage) => void;

export type ManagerMessageListener = (message: ManagerMessage) => void | Promise<void>;

export type OutputListener = (stream: OutputStream, chunk: Buffer) => void;

export type ServiceData = {
  serviceId: string;
  label: string;
  preferredPort: number | undefined;
  packageRoot: string;
};

export type WorkerServiceData = ServiceData & {
  serviceModuleUrl: string;
  tsxApiUrl: string;
};

export type ServiceRuntime = {
  data: ServiceData;
  postMessage(message: ServiceMessage): void;
  onMessage(listener: ManagerMessageListener): Unsubscribe;
};

export type ServiceHandle = {
  stop?(): void | Promise<void>;
};

export type StartService = (runtime: ServiceRuntime) => void | ServiceHandle | Promise<void | ServiceHandle>;

export type ServiceModule = {
  default: StartService;
};

export type ServiceDefinition = {
  id: string;
  label: string;
  hint: string;
  serviceModuleUrl: URL;
  preferredPort?: number;
};

export type LogEntry = {
  at: Date;
  stream: OutputStream;
  line: string;
};

export type ServiceRunner = {
  kind: RunnerKind;
  exitPromise: Promise<RunnerExitCode>;
  onMessage(listener: ServiceMessageListener): Unsubscribe;
  onOutput(listener: OutputListener): Unsubscribe;
  send(message: ManagerMessage): void;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  terminate(): void | Promise<void>;
};

export type ServiceRuntimeState = ServiceDefinition & {
  status: string;
  url: string | undefined;
  logs: LogEntry[];
  partial: Record<OutputStream, string>;
  runner: ServiceRunner | undefined;
  exitPromise: Promise<RunnerExitCode> | undefined;
};

import type { RawOutputBuffer, TerminalSize } from "bit-lite-terminal";

export type RunnerMode = "worker" | "inline";

export type RunnerKind = RunnerMode;

export type OutputStream = "stdout" | "stderr";

export type RunnerExitCode = number | null | undefined;

export type Unsubscribe = () => void;

export type VendorReadyMessage = {
  type: "ready";
  url?: string;
};

export type VendorStatusMessage = {
  type: "status";
  status: string;
};

export type VendorErrorMessage = {
  type: "error";
  message: string;
};

export type VendorMessage = VendorReadyMessage | VendorStatusMessage | VendorErrorMessage;

export type ManagerShutdownMessage = {
  type: "shutdown";
};

export type ManagerMessage = ManagerShutdownMessage;

export type VendorMessageListener = (message: VendorMessage) => void;

export type ManagerMessageListener = (message: ManagerMessage) => void | Promise<void>;

export type OutputListener = (stream: OutputStream, chunk: Buffer) => void;

export type VendorConfig = Record<string, unknown>;

export type DevServerVendorConfig = VendorConfig & {
  preferredPort?: number;
};

export type VendorData<Config extends VendorConfig = VendorConfig> = {
  vendorId: string;
  label: string;
  config: Config;
  packageRoot: string;
};

export type WorkerVendorData<Config extends VendorConfig = VendorConfig> = {
  vendorData: VendorData<Config>;
  vendorModuleUrl: string;
  terminalApiUrl: string;
  terminal: TerminalSize;
  emulateTty: boolean;
  tsxApiUrl: string;
};

export type VendorRuntime<Config extends VendorConfig = VendorConfig> = {
  data: VendorData<Config>;
  postMessage(message: VendorMessage): void;
  onMessage(listener: ManagerMessageListener): Unsubscribe;
};

export type VendorHandle = {
  stop?(): void | Promise<void>;
};

export type StartVendor<Config extends VendorConfig = VendorConfig> = (
  runtime: VendorRuntime<Config>
) => void | VendorHandle | Promise<void | VendorHandle>;

export type VendorModule<Config extends VendorConfig = VendorConfig> = {
  default: StartVendor<Config>;
};

export type VendorDefinition<Config extends VendorConfig = VendorConfig> = {
  id: string;
  label: string;
  hint: string;
  vendorModuleUrl: URL;
  config?: Config;
};

export type VendorRunner = {
  kind: RunnerKind;
  exitPromise: Promise<RunnerExitCode>;
  onMessage(listener: VendorMessageListener): Unsubscribe;
  onOutput(listener: OutputListener): Unsubscribe;
  send(message: ManagerMessage): void;
  writeInput(chunk: Buffer | string): void;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  terminate(): void | Promise<void>;
};

export type VendorRuntimeState<Config extends VendorConfig = VendorConfig> = VendorDefinition<Config> & {
  status: string;
  url: string | undefined;
  rawOutput: RawOutputBuffer;
  runner: VendorRunner | undefined;
  exitPromise: Promise<RunnerExitCode> | undefined;
};

import type { ManagedTerminalItem, RawOutputBuffer } from "bit-lite-terminal";
import type {
  Runner,
  RunnerExitCode,
  RunnerHandle,
  RunnerMode,
  RunnerOutputStream,
  RunnerRuntime,
  RunnerTargetDefinition,
} from "bit-lite-runner";

export type { RunnerExitCode, RunnerMode };

export type OutputStream = RunnerOutputStream;

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

export type VendorRuntime<Config extends VendorConfig = VendorConfig> = RunnerRuntime<VendorData<Config>, VendorMessage>;

export type VendorHandle = RunnerHandle;

export type VendorDefinition<Config extends VendorConfig = VendorConfig> = RunnerTargetDefinition & {
  id: string;
  label: string;
  hint: string;
  config?: Config;
};

export type VendorRunner<Config extends VendorConfig = VendorConfig> = Runner<VendorData<Config>, VendorMessage>;

export type VendorRuntimeState<Config extends VendorConfig = VendorConfig> = VendorDefinition<Config> &
  ManagedTerminalItem & {
    status: string;
    url: string | undefined;
    rawOutput: RawOutputBuffer;
    runner: VendorRunner<Config> | undefined;
    exitPromise: Promise<RunnerExitCode> | undefined;
  };

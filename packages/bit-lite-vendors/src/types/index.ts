import type { CliArguments, ComponentRef, WorkspaceRuntime } from "bit-lite-context";
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

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = {
  [key: string]: JsonValue;
};

export type VendorReadyMessage = {
  type: "ready";
};

export type VendorStatusMessage = {
  type: "status";
  status: string;
};

export type VendorErrorMessage = {
  type: "error";
  message: string;
};

export type VendorResultMessage<Data extends JsonValue = JsonValue> = {
  type: "result";
  data: Data;
};

export type VendorMessage<Data extends JsonValue = JsonValue> =
  | VendorReadyMessage
  | VendorStatusMessage
  | VendorErrorMessage
  | VendorResultMessage<Data>;

export type VendorConfig = Record<string, unknown>;

export type VendorData<Config extends VendorConfig = VendorConfig> = {
  components: ComponentRef[];
  config: Config;
  args: CliArguments;
  context?: WorkspaceRuntime;
};

export type VendorRuntime<Config extends VendorConfig = VendorConfig> = RunnerRuntime<
  VendorData<Config>,
  VendorMessage
>;

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
    details: string[];
    result: JsonValue | undefined;
    rawOutput: RawOutputBuffer;
    runner: VendorRunner<Config> | undefined;
    exitPromise: Promise<RunnerExitCode> | undefined;
  };

import type { CliArguments, ComponentRef, WorkspaceRuntime } from "bit-lite-context";
import type { ManagedTerminalItem, RawOutputBuffer } from "bit-lite-terminal";
import type {
  Runner,
  RunnerExitCode,
  RunnerStartResult,
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

export type TestServiceResult = {
  service: "test";
  vendor: string;
  mode: "run" | "watch";
  run: number;
  componentIds: string[];
  args: CliArguments;
  config: JsonObject;
  total: number;
  passed: number;
  failed: number;
  summary: string;
};

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

export type VendorStartResult<Data = unknown> = RunnerStartResult<Data>;

export type VendorDefinition<Config extends VendorConfig = VendorConfig> = RunnerTargetDefinition & {
  id: string;
  label: string;
  hint: string;
  config?: Config;
};

export type VendorRunner<Config extends VendorConfig = VendorConfig, ResultData = unknown> = Runner<
  VendorData<Config>,
  VendorMessage,
  never,
  ResultData
>;

export type VendorRuntimeState<
  Config extends VendorConfig = VendorConfig,
  ResultData extends JsonValue = JsonValue,
> = VendorDefinition<Config> &
  ManagedTerminalItem & {
    status: string;
    details: string[];
    result: ResultData | undefined;
    rawOutput: RawOutputBuffer;
    runner: VendorRunner<Config, ResultData> | undefined;
    exitPromise: Promise<RunnerExitCode> | undefined;
  };

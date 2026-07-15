import type { CliArguments, ComponentRef } from "bit-lite-context";
import type { ManagedTerminalItem, RawOutputBuffer } from "bit-lite-terminal";
import type {
  Runner,
  RunnerExitCode,
  RunnerParentMessage,
  RunnerStartResult,
  RunnerMode,
  RunnerOutputStream,
  RunnerRuntime,
  RunnerTargetDefinition,
} from "../runner/index.js";

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

export type VendorParentMessage<Message extends JsonValue = JsonValue> = RunnerParentMessage<Message>;

export type VendorConfig = Record<string, unknown>;

export type VendorData<
  Config extends VendorConfig = VendorConfig,
  Runtime extends JsonObject = JsonObject,
> = {
  envName: string;
  components: ComponentRef[];
  config: Config;
  args: CliArguments;
  runtime?: Runtime;
};

export type VendorRuntime<
  Config extends VendorConfig = VendorConfig,
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
  Runtime extends JsonObject = JsonObject,
> = RunnerRuntime<
  VendorData<Config, Runtime>,
  VendorMessage<EventResult>,
  InputMessage
>;

export type VendorStartResult<Data = unknown> = RunnerStartResult<Data>;

export type VendorDefinition = RunnerTargetDefinition & {
  id: string;
  label: string;
  hint: string;
};

export type VendorRunner<
  Config extends VendorConfig = VendorConfig,
  RunResult = unknown,
  EventResult extends JsonValue = JsonValue,
  InputMessage extends JsonValue = JsonValue,
> = Runner<
  VendorData<Config>,
  VendorMessage<EventResult>,
  InputMessage,
  RunResult
>;

export type VendorRuntimeState<
  Config extends VendorConfig = VendorConfig,
  ResultData extends JsonValue = JsonValue,
> = VendorDefinition &
  ManagedTerminalItem & {
    status: string;
    details: string[];
    result: ResultData | undefined;
    rawOutput: RawOutputBuffer;
    runner: VendorRunner<Config, ResultData, ResultData> | undefined;
    exitPromise: Promise<RunnerExitCode> | undefined;
  };

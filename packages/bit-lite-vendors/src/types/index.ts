import type { Workspace, WorkspaceComponent } from "bit-lite-context";
import type { CliArguments, JsonObject, JsonValue } from "bit-lite-utils";
import type { PackageLocation, SelectedEnvIdentity } from "bit-lite-env-resolution";
import type {
  Runner,
  RunnerStartResult,
  RunnerMode,
  RunnerOutputStream,
  RunnerRuntime,
  RunnerTargetDefinition,
} from "../runner/index.js";

export type { RunnerMode, RunnerOutputStream as OutputStream };
export type { JsonObject, JsonPrimitive, JsonValue } from "bit-lite-utils";

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

export type VendorConfig = JsonObject;

export type VendorContext = {
  readonly version: 1;
  readonly workspace: Workspace;
  readonly args: CliArguments;
  readonly env: SelectedEnvIdentity;
  readonly service: {
    readonly name: string;
    readonly source: PackageLocation;
  };
};

export type VendorData<
  Config extends VendorConfig = VendorConfig,
  Runtime extends JsonObject = JsonObject,
> = {
  context: VendorContext;
  components: readonly WorkspaceComponent[];
  config: Config;
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

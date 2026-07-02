import type { CliArguments, ComponentRef, WorkspaceRuntime } from "bit-lite-context";

// JSON types

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = {
  [key: string]: JsonValue;
};

// event listeners

export type ServiceVendorEventType = "result" | "progress";

export type ServiceVendorEventPayload = {
  // for all types
  status: string;
  message?: string;
  // for `status` type
  total?: number;
  current?: number;
  label?: string;
  // for `result` type
  data?: unknown;
};

export type ServiceVendorEventListener = (
  type: ServiceVendorEventType,
  payload: ServiceVendorEventPayload
) => void;

// calls

export type ServiceVendorCallType = "run" | "stop" | "stdin" | string;

export type ServiceVendorCallPayload = {
  // for `run` and `stop` types
  reason?: string;
  // for `stdin` type
  chunk?: string | Uint8Array;
  // for extended types
  data?: unknown;
};

// input and output

export type ServiceVendorInput<Config = unknown, Args = CliArguments> = {
  components: ComponentRef[];
  config: Config;
  args: Args;
};

export type ServiceVendorResult<ResultData = unknown> = {
  status: string;
  data: ResultData;
  toJSON(): ResultData;
  toString(forTerminal?: boolean): string;
};

// vendor and returned value

export type ServiceVendorTask<ResultData = unknown> = {
  result: Promise<ServiceVendorResult<ResultData>>;
  abort(): void;
  call(type: ServiceVendorCallType, payload?: ServiceVendorCallPayload): void;
};

export type ServiceVendor<Config = unknown, Args = CliArguments, ResultData = unknown> = {
  name: string;
  run(
    input: ServiceVendorInput<Config, Args>,
    context?: WorkspaceRuntime,
    listener?: ServiceVendorEventListener
  ): ServiceVendorTask<ResultData>;
};

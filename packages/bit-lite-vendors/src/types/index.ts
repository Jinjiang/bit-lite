import type { CliArguments, ComponentRef, WorkspaceRuntime } from "bit-lite-context";

// JSON types

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = {
  [key: string]: JsonValue;
};

// event listeners

export type ServiceVendorEventType = "log" | "status" | "result" | "progress" | string;

export type ServiceVendorEventPayload = {
  // for all types
  message?: string;
  // for `log` type
  level?: "debug" | "info" | "warn" | "error" | string;
  scope?: string;
  // for `status` type
  status?: string;
  // for `progress` type
  total?: number;
  current?: number;
  label?: string;
  // for `result` type and other extended types
  data?: unknown;
};

export type ServiceVendorEventListener = (
  type: ServiceVendorEventType,
  payload: ServiceVendorEventPayload
) => void

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
  toJSON(): ResultData;
  toString(forTerminal?: boolean): string;
};

// vendor and returned value

export type ServiceVendorTask<ResultData = unknown> = {
  result: Promise<ServiceVendorResult<ResultData>>;
  listen(listener: ServiceVendorEventListener): () => void;
  abort(): void;
  call(type: ServiceVendorCallType, payload?: ServiceVendorCallPayload): void;
};

export type ServiceVendor<Config = unknown, Args = CliArguments, ResultData = unknown> = {
  name: string;
  run(input: ServiceVendorInput<Config, Args>, context?: WorkspaceRuntime): ServiceVendorTask<ResultData>;
};

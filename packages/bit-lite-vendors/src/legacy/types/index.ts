import type { CliArguments, ComponentRef, WorkspaceRuntime } from "bit-lite-context";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = {
  [key: string]: JsonValue;
};

export type ServiceVendorEventType = "result" | "progress";

export type ServiceVendorEventPayload = {
  status: string;
  message?: string;
  total?: number;
  current?: number;
  label?: string;
  data?: unknown;
};

export type ServiceVendorEventListener = (
  type: ServiceVendorEventType,
  payload: ServiceVendorEventPayload
) => void;

export type ServiceVendorCallType = "run" | "stop" | "stdin" | string;

export type ServiceVendorCallPayload = {
  reason?: string;
  chunk?: string | Uint8Array;
  data?: unknown;
};

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

import type { ComponentRef, WorkspaceRuntime } from "bit-lite-context";

// Service Vendor interface

export type ServiceVendorInput<Config = unknown, Args = unknown> = {
  components: ComponentRef[];
  config: Config;
  args: Args;
};

export type ServiceVendorResult<JsonValue = unknown> = {
  status: string;
  toJSON(): JsonValue;
  toString(forTerminal: boolean): string;
};

export type ServiceVendorEventListener = (type: string, payload: unknown) => void;

export type ServiceVendorTask<Result = ServiceVendorResult> = {
  result: Promise<Result>;
  listen(listener: ServiceVendorEventListener): () => void;
  abort(): void;
  call(type: string, payload?: unknown): void;
};

export type ServiceVendor<
  Config = unknown,
  Args = unknown,
  Result extends ServiceVendorResult = ServiceVendorResult,
> = {
  name: string;
  run(input: ServiceVendorInput<Config, Args>, context?: WorkspaceRuntime): ServiceVendorTask<Result>;
};

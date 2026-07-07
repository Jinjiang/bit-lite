import type { CliArguments, ComponentRef, WorkspaceRuntime } from "bit-lite-context";

export type { CliArguments, ComponentRef, WorkspaceRuntime } from "bit-lite-context";

export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  TestServiceResult,
  VendorConfig,
  VendorData,
  VendorDefinition,
  VendorMessage,
  VendorRuntime,
} from "bit-lite-vendors";

export type ServiceRunInput = {
  components: ComponentRef[];
  args: CliArguments;
  context: WorkspaceRuntime;
};

export type ServiceDefinition = {
  id: string;
  label: string;
  run(input: ServiceRunInput): void | Promise<void>;
};

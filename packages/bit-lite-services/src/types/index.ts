import type { CliArguments, ComponentRef, WorkspaceRuntime } from "bit-lite-context";
import type { ManagedTerminalInputStream } from "bit-lite-terminal";
import type { RunnerExitCode, RunnerMode } from "bit-lite-runner";
import type {
  JsonValue,
  VendorConfig,
  VendorData,
  VendorDefinition,
  VendorMessage,
  VendorRuntime,
} from "bit-lite-vendors";

export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  VendorConfig,
  VendorData,
  VendorDefinition,
  VendorMessage,
  VendorRuntime,
} from "bit-lite-vendors";

export type { RunnerExitCode, RunnerMode };

export type ServiceMode = "run" | "watch";

export type ServiceInput<Config extends VendorConfig = VendorConfig> = {
  components: ComponentRef[];
  config: Config;
  args: CliArguments;
  context: WorkspaceRuntime;
};

export type ServiceCreateTasksInput<Config extends VendorConfig = VendorConfig> = ServiceInput<Config> & {
  mode: ServiceMode;
  vendors: Array<ServiceVendorDefinition<Config>>;
};

export type ServiceTaskInput<Config extends VendorConfig = VendorConfig> = {
  id: string;
  label: string;
  vendor: ServiceVendorDefinition<Config>;
  data: VendorData<Config>;
};

export type ServiceVendorDefinition<Config extends VendorConfig = VendorConfig> = VendorDefinition<Config>;

export type ServiceDefinition<Config extends VendorConfig = VendorConfig> = {
  id: string;
  label: string;
  createTasks(input: ServiceCreateTasksInput<Config>): Array<ServiceTaskInput<Config>> | Promise<Array<ServiceTaskInput<Config>>>;
  formatDetails?(result: JsonValue): string[];
};

export type ServiceTaskResult = {
  taskId: string;
  vendorId: string;
  data: JsonValue | undefined;
  exitCode: RunnerExitCode;
};

export type ServiceResult = {
  serviceId: string;
  mode: ServiceMode;
  status: string;
  results: ServiceTaskResult[];
};

export type ServiceTerminalOptions = {
  enabled?: boolean | undefined;
  autoStopMs?: number | undefined;
  stdin?: ManagedTerminalInputStream | undefined;
  stdout?: NodeJS.WriteStream | undefined;
  stderr?: NodeJS.WriteStream | undefined;
};

export type RunServiceOptions<Config extends VendorConfig = VendorConfig> = {
  service: ServiceDefinition<Config>;
  vendors?: Array<ServiceVendorDefinition<Config>> | undefined;
  input: ServiceInput<Config>;
  runnerMode?: RunnerMode | undefined;
  terminal?: ServiceTerminalOptions | undefined;
};

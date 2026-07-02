import type { CliArguments } from "bit-lite-context";
import type {
  ServiceVendor,
  ServiceVendorEventPayload,
  ServiceVendorEventType,
  ServiceVendorInput,
  ServiceVendorResult,
  ServiceVendorTask,
} from "bit-lite-vendors";
import { demoWorkspaceRuntime } from "./runtime.js";

export type VendorDemoOptions<Config, ResultData> = {
  title: string;
  vendor: ServiceVendor<Config, CliArguments, ResultData>;
  input: ServiceVendorInput<Config, CliArguments>;
  beforeResult?: (task: ServiceVendorTask<ResultData>) => void | Promise<void>;
  afterResult?: (
    task: ServiceVendorTask<ResultData>,
    result: ServiceVendorResult<ResultData>
  ) => void | Promise<void>;
};

export async function runVendorDemo<Config, ResultData>(options: VendorDemoOptions<Config, ResultData>) {
  printHeader(options.title);
  printInput(options.input);

  const startedAt = Date.now();
  const task = options.vendor.run(options.input, demoWorkspaceRuntime, (type, payload) => {
    printEvent(type, payload, Date.now() - startedAt);
  });

  await options.beforeResult?.(task);
  const result = await task.result;
  printResult(result);
  await options.afterResult?.(task, result);
}

export function reportDemoError(error: unknown) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}

function printHeader(title: string) {
  console.log("");
  console.log(`=== ${title} ===`);
}

function printInput(input: ServiceVendorInput<unknown, CliArguments>) {
  console.log(
    formatJson({
      workspaceRoot: demoWorkspaceRuntime.workspaceRoot,
      components: input.components.map((component) => component.id),
      config: input.config,
      args: input.args,
    })
  );
}

function printEvent(type: ServiceVendorEventType, payload: ServiceVendorEventPayload, elapsedMs: number) {
  console.log(`[+${elapsedMs}ms] event:${type} ${formatJson(payload)}`);
}

function printResult<ResultData>(result: ServiceVendorResult<ResultData>) {
  console.log(`result.status: ${result.status}`);
  console.log(`result.text: ${result.toString(true)}`);
  console.log(`result.json: ${formatJson(result.toJSON())}`);
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

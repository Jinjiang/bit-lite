import type {
  JsonValue,
  VendorData,
  VendorDefinition,
  VendorMessage,
} from "bit-lite-vendors";
import { createRunner } from "bit-lite-runner";
import { demoWorkspaceRuntime } from "./runtime.js";

export type VendorDemoTask = {
  stop(reason?: string): Promise<void>;
};

export type VendorDemoOptions<Config extends Record<string, unknown>> = {
  title: string;
  vendor: VendorDefinition<Config>;
  input: VendorData<Config>;
  beforeResult?: (task: VendorDemoTask) => void | Promise<void>;
  afterResult?: (task: VendorDemoTask, result: JsonValue) => void | Promise<void>;
};

export async function runVendorDemo<Config extends Record<string, unknown>>(options: VendorDemoOptions<Config>) {
  printHeader(options.title);
  printInput(options.input);

  const startedAt = Date.now();
  let latestStatus = "starting";
  let resolveResult!: (result: JsonValue) => void;
  let rejectResult!: (error: unknown) => void;
  const resultPromise = new Promise<JsonValue>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const runner = createRunner<VendorData<Config>, VendorMessage>({
    mode: "inline",
    target: options.vendor,
    data: {
      ...options.input,
      context: demoWorkspaceRuntime,
    },
  });

  runner.onMessage((message) => {
    if (message.type === "status") latestStatus = message.status;
    if (message.type === "result") resolveResult(message.data);
    if (message.type === "error") rejectResult(new Error(message.message));
    printMessage(message, Date.now() - startedAt);
  });

  runner.onOutput((stream, chunk) => {
    const target = stream === "stderr" ? process.stderr : process.stdout;
    target.write(chunk);
  });

  Promise.resolve(runner.start()).catch(rejectResult);

  const task: VendorDemoTask = {
    async stop(reason) {
      if (reason) console.log(`stop.reason: ${reason}`);
      await runner.stop();
    },
  };

  await options.beforeResult?.(task);
  const result = await resultPromise;
  printResult(result, latestStatus);
  await options.afterResult?.(task, result);
  await runner.stop();
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

function printInput(input: VendorData) {
  console.log(
    formatJson({
      workspaceRoot: demoWorkspaceRuntime.workspaceRoot,
      components: input.components.map((component) => component.id),
      config: input.config,
      args: input.args,
    })
  );
}

function printMessage(message: VendorMessage, elapsedMs: number) {
  console.log(`[+${elapsedMs}ms] message:${message.type} ${formatJson(message)}`);
}

function printResult(result: JsonValue, status: string) {
  console.log(`result.status: ${status}`);
  console.log(`result.json: ${formatJson(result)}`);
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

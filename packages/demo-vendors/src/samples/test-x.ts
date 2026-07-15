import type {
  JsonObject,
  JsonValue,
  VendorDefinition,
  VendorStartResult,
  VendorRuntime,
} from "bit-lite-vendors";
import type { TestServiceResult } from "./test-result.js";
import { isShutdownMessage, wait } from "./vendor-utils.js";

export const meta: VendorDefinition = {
  id: "test-x",
  label: "Test X",
  hint: "Sample test runner x",
  moduleUrl: import.meta.url,
};

export default async function startTestXVendor(
  runtime: VendorRuntime<Record<string, unknown>, TestServiceResult>
): Promise<VendorStartResult<TestServiceResult>> {
  const watch = runtime.data.args.options.watch === true && isInteractiveTerminal();
  const mode = watch ? "watch" : "run";
  const componentIds = runtime.data.components.map((component) => component.id);
  let finished = false;
  let run = 0;
  let timer: NodeJS.Timeout | undefined;
  let unsubscribe: (() => void) | undefined;

  const finish = (status: string) => {
    if (finished) return;
    finished = true;
    if (timer) clearInterval(timer);
    runtime.postMessage({ type: "status", status });
    unsubscribe?.();
  };

  const createResult = () => {
    run += 1;
    const total = componentIds.length * 2;
    const failed = 0;
    const passed = total - failed;

    return {
      service: "test",
      env: runtime.data.env,
      vendor: "x",
      mode,
      run,
      componentIds,
      args: runtime.data.args,
      config: toJsonObject(runtime.data.config),
      total,
      passed,
      failed,
      summary: `${passed}/${total} passed`,
    } satisfies TestServiceResult;
  };

  const emitResult = () => {
    const data = createResult();
    console.log(`[test-x] ${mode} #${run}: ${data.summary}`);
    runtime.postMessage({ type: "result", data });
  };

  unsubscribe = runtime.onMessage((message) => {
    if (isShutdownMessage(message)) finish("stopped");
  });

  runtime.postMessage({ type: "ready" });

  if (watch) {
    runtime.postMessage({ type: "status", status: "watching" });
    emitResult();
    timer = setInterval(emitResult, 250);
    return {
      stop() {
        finish("stopped");
      },
    };
  }

  const data = await runOnce();
  return data === undefined ? {} : { data };

  async function runOnce(): Promise<TestServiceResult | undefined> {
    runtime.postMessage({ type: "status", status: "running" });
    await wait(10);
    if (finished) return undefined;
    const data = createResult();
    finish("success");
    return data;
  }
}

function toJsonObject(config: Record<string, unknown>): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(config)) {
    if (isJsonValue(value)) result[key] = value;
  }
  return result;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value).every(isJsonValue);
  return false;
}

function isInteractiveTerminal() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

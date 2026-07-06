import type { CliArguments } from "bit-lite-context";
import type { JsonObject, JsonValue, VendorDefinition, VendorHandle, VendorRuntime } from "../types/index.js";
import { isShutdownMessage, wait } from "../vendor-utils.js";

export type TestYResult = {
  service: "test";
  vendor: "y";
  mode: "run" | "watch";
  run: number;
  componentIds: string[];
  args: CliArguments;
  config: JsonObject;
  total: number;
  passed: number;
  failed: number;
  summary: string;
};

export const meta: VendorDefinition = {
  id: "test-y",
  label: "Test Y",
  hint: "Sample test runner y",
  moduleUrl: import.meta.url,
};

export default function startTestYVendor(runtime: VendorRuntime<Record<string, unknown>>): VendorHandle {
  const watch = runtime.data.args.options.watch === true;
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

  const emitResult = () => {
    run += 1;
    const total = componentIds.length * 3;
    const failed = run % 4 === 0 ? 1 : 0;
    const passed = total - failed;
    const data: TestYResult = {
      service: "test",
      vendor: "y",
      mode,
      run,
      componentIds,
      args: runtime.data.args,
      config: toJsonObject(runtime.data.config),
      total,
      passed,
      failed,
      summary: failed === 0 ? `${passed}/${total} passed` : `${failed}/${total} failed`,
    };

    const stream = failed === 0 ? console.log : console.error;
    stream(`[test-y] ${mode} #${run}: ${data.summary}`);
    runtime.postMessage({ type: "result", data });
  };

  unsubscribe = runtime.onMessage((message) => {
    if (isShutdownMessage(message)) finish("stopped");
  });

  runtime.postMessage({ type: "ready" });

  if (watch) {
    runtime.postMessage({ type: "status", status: "watching" });
    emitResult();
    timer = setInterval(emitResult, 400);
    return {
      stop() {
        finish("stopped");
      },
    };
  }

  void runOnce();

  return {
    stop() {
      finish("stopped");
    },
  };

  async function runOnce() {
    runtime.postMessage({ type: "status", status: "running" });
    await wait(20);
    if (finished) return;
    emitResult();
    finish("success");
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

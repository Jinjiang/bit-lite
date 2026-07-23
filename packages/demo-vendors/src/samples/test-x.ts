import type {
  JsonObject,
  VendorDefinition,
  VendorStartResult,
  VendorRuntime,
} from "bit-lite-vendors";
import type { TestServiceResult } from "./test-result.js";
import { wait } from "./vendor-utils.js";

export const meta: VendorDefinition = {
  id: "test-x",
  label: "Test X",
  hint: "Sample test runner x",
  moduleUrl: import.meta.url,
};

export default async function startTestXVendor(
  runtime: VendorRuntime<JsonObject, TestServiceResult>
): Promise<VendorStartResult<TestServiceResult>> {
  const watch = runtime.data.context.args.options.watch === true && isInteractiveTerminal();
  const mode = watch ? "watch" : "run";
  const componentIds = runtime.data.components.map((component) => component.id);
  let finished = false;
  let run = 0;
  let timer: NodeJS.Timeout | undefined;
  const finish = (status: string) => {
    if (finished) return;
    finished = true;
    if (timer) clearInterval(timer);
    runtime.postMessage({ type: "status", status });
  };

  const createResult = () => {
    run += 1;
    const total = componentIds.length * 2;
    const failed = 0;
    const passed = total - failed;

    return {
      mode,
      run,
      stats: { total, passed, failed, skipped: 0, summary: `${passed}/${total} passed` },
      componentResults: componentIds.map((componentId) => ({
        componentId,
        files: [],
        stats: { total: 2, passed: 2, failed: 0, skipped: 0, summary: "2/2 passed" },
        durationMs: 0,
        errors: [],
      })),
      ...(runtime.data.context.args.options.coverage === true ? { coverage: { enabled: true } } : {}),
    } satisfies TestServiceResult;
  };

  const emitResult = () => {
    const data = createResult();
    console.log(`[test-x] ${mode} #${run}: ${data.stats.summary}`);
    runtime.postMessage({ type: "result", data });
  };

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

function isInteractiveTerminal() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

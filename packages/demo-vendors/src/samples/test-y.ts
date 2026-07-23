import type {
  JsonObject,
  VendorDefinition,
  VendorStartResult,
  VendorRuntime,
} from "bit-lite-vendors";
import { isInteractiveTerminal } from "bit-lite-utils/node";
import type { TestServiceResult } from "./test-result.js";
import { wait } from "./vendor-utils.js";

export const meta: VendorDefinition = {
  id: "test-y",
  label: "Test Y",
  hint: "Sample test runner y",
  moduleUrl: import.meta.url,
};

export default async function startTestYVendor(
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
    const total = componentIds.length * 3;
    const failed = run % 4 === 0 ? 1 : 0;
    const passed = total - failed;

    return {
      mode,
      run,
      stats: {
        total,
        passed,
        failed,
        skipped: 0,
        summary: failed === 0 ? `${passed}/${total} passed` : `${failed}/${total} failed`,
      },
      componentResults: componentIds.map((componentId, index) => {
        const componentFailed = failed > 0 && index === 0 ? 1 : 0;
        return {
          componentId,
          files: [],
          stats: {
            total: 3,
            passed: 3 - componentFailed,
            failed: componentFailed,
            skipped: 0,
            summary: componentFailed ? "1/3 failed" : "3/3 passed",
          },
          durationMs: 0,
          errors: componentFailed ? ["sample failure"] : [],
        };
      }),
      ...(runtime.data.context.args.options.coverage === true ? { coverage: { enabled: true } } : {}),
    } satisfies TestServiceResult;
  };

  const emitResult = () => {
    const data = createResult();
    const stream = data.stats.failed === 0 ? console.log : console.error;
    stream(`[test-y] ${mode} #${run}: ${data.stats.summary}`);
    runtime.postMessage({ type: "result", data });
  };

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

  const data = await runOnce();
  return data === undefined ? {} : { data };

  async function runOnce(): Promise<TestServiceResult | undefined> {
    runtime.postMessage({ type: "status", status: "running" });
    await wait(20);
    if (finished) return undefined;
    const data = createResult();
    finish("success");
    return data;
  }
}

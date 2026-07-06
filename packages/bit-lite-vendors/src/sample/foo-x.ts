import type { VendorDefinition, VendorHandle, VendorRuntime } from "../types/index.js";
import { isShutdownMessage, wait } from "../vendor-utils.js";

export type FooXResult = {
  service: "foo";
  vendor: "x";
  compList: string[];
  calls: string[];
};

export const meta: VendorDefinition = {
  id: "foo-x",
  label: "Foo X",
  hint: "Demo vendor for foo service using vendor x",
  moduleUrl: import.meta.url,
};

export default function startFooXVendor(runtime: VendorRuntime<Record<string, unknown>>): VendorHandle {
  const calls: string[] = [];
  const data: FooXResult = {
    service: "foo",
    vendor: "x",
    compList: runtime.data.components.map((component) => component.id),
    calls,
  };

  let finished = false;
  let unsubscribe: (() => void) | undefined;

  const finish = (status: string) => {
    if (finished) return;
    finished = true;
    runtime.postMessage({ type: "status", status });
    runtime.postMessage({ type: "result", data });
    unsubscribe?.();
  };

  unsubscribe = runtime.onMessage((message) => {
    if (isShutdownMessage(message)) finish("stopped");
  });

  runtime.postMessage({ type: "ready" });

  void runProgress();

  return {
    stop() {
      finish("stopped");
    },
  };

  async function runProgress() {
    runtime.postMessage({ type: "status", status: "running" });
    await wait(10);
    if (finished) return;
    runtime.postMessage({ type: "status", status: "running" });
    await wait(10);
    if (finished) return;
    runtime.postMessage({ type: "status", status: "running" });
    await wait(10);
    finish("success");
  }
}

import type { VendorDefinition, VendorStartResult, VendorRuntime } from "../types/index.js";
import { isShutdownMessage } from "../vendor-utils.js";

export type BarYResult = {
  service: "bar";
  vendor: "y";
  count: number;
};

export const meta: VendorDefinition = {
  id: "bar-y",
  label: "Bar Y",
  hint: "Demo vendor for bar service using vendor y",
  moduleUrl: import.meta.url,
};

export default function startBarYVendor(runtime: VendorRuntime<Record<string, unknown>>): VendorStartResult {
  let completed = false;
  let timer: NodeJS.Timeout | undefined;
  let unsubscribe: (() => void) | undefined;

  const finish = (status: string) => {
    if (completed) return;
    completed = true;
    if (timer) clearTimeout(timer);

    const data: BarYResult = {
      service: "bar",
      vendor: "y",
      count: runtime.data.components.length,
    };

    runtime.postMessage({ type: "status", status });
    runtime.postMessage({ type: "result", data });
    unsubscribe?.();
  };

  unsubscribe = runtime.onMessage((message) => {
    if (isShutdownMessage(message)) finish("stopped");
  });

  runtime.postMessage({ type: "ready" });

  timer = setTimeout(() => {
    runtime.postMessage({ type: "status", status: "running" });
    finish("success");
  }, 0);

  return {
    stop() {
      finish("stopped");
    },
  };
}

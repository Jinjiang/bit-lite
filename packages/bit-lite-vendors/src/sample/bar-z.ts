import type { VendorDefinition, VendorStartResult, VendorRuntime } from "../types/index.js";
import { isShutdownMessage } from "../vendor-utils.js";

export type BarZResult = {
  service: "bar";
  vendor: "z";
  statusText: string;
};

export const meta: VendorDefinition = {
  id: "bar-z",
  label: "Bar Z",
  hint: "Demo vendor for bar service using vendor z",
  moduleUrl: import.meta.url,
};

export default function startBarZVendor(runtime: VendorRuntime<Record<string, unknown>>): VendorStartResult {
  let finished = false;
  let timer: NodeJS.Timeout | undefined;
  let unsubscribe: (() => void) | undefined;

  const finish = (status: string) => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);

    const data: BarZResult = {
      service: "bar",
      vendor: "z",
      statusText: `${status}:${runtime.data.components.length}`,
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
    runtime.postMessage({ type: "status", status: "running" });
    runtime.postMessage({ type: "status", status: "running" });
    finish("success");
  }, typeof runtime.data.config.delay === "number" ? runtime.data.config.delay : 0);

  return {
    stop() {
      finish("stopped");
    },
  };
}

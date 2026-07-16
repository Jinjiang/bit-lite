import type { CliArguments } from "bit-lite-context";
import type { JsonObject, VendorDefinition, VendorStartResult, VendorRuntime } from "bit-lite-vendors";
import { isShutdownMessage } from "./vendor-utils.js";

export type BarXResult = {
  service: "bar";
  vendor: "x";
  componentIds: string[];
  args: CliArguments;
  calls: string[];
};

export const meta: VendorDefinition = {
  id: "bar-x",
  label: "Bar X",
  hint: "Demo vendor for bar service using vendor x",
  moduleUrl: import.meta.url,
};

export default function startBarXVendor(runtime: VendorRuntime<JsonObject>): VendorStartResult {
  const calls: string[] = [];
  const data: BarXResult = {
    service: "bar",
    vendor: "x",
    componentIds: runtime.data.components.map((component) => component.id),
    args: runtime.data.context.args,
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
  runtime.postMessage({ type: "status", status: "running" });
  queueMicrotask(() => finish("success"));

  return {
    stop() {
      finish("stopped");
    },
  };
}

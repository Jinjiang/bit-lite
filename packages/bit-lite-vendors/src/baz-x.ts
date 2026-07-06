import type { CliArguments } from "bit-lite-context";
import type { VendorDefinition, VendorHandle, VendorRuntime } from "./types/index.js";
import { isShutdownMessage } from "./vendor-utils.js";

export type BazXResult = {
  service: "baz";
  vendor: "x";
  componentIds: string[];
  args: CliArguments;
  calls: string[];
};

export const bazXVendor: VendorDefinition<Record<string, unknown>> = {
  id: "baz-x",
  label: "Baz X",
  hint: "Demo vendor for baz service using vendor x",
  moduleUrl: import.meta.url,
};

export default function startBazXVendor(runtime: VendorRuntime<Record<string, unknown>>): VendorHandle {
  const calls: string[] = [];
  const data: BazXResult = {
    service: "baz",
    vendor: "x",
    componentIds: runtime.data.components.map((component) => component.id),
    args: runtime.data.args,
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

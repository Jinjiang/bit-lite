import type { CliArguments } from "bit-lite-context";
import type { JsonObject, VendorDefinition, VendorStartResult, VendorRuntime } from "bit-lite-vendors";

export type BazXResult = {
  service: "baz";
  vendor: "x";
  componentIds: string[];
  args: CliArguments;
  calls: string[];
};

export const meta: VendorDefinition = {
  id: "baz-x",
  label: "Baz X",
  hint: "Demo vendor for baz service using vendor x",
  moduleUrl: import.meta.url,
};

export default function startBazXVendor(runtime: VendorRuntime<JsonObject>): VendorStartResult {
  const calls: string[] = [];
  const data: BazXResult = {
    service: "baz",
    vendor: "x",
    componentIds: runtime.data.components.map((component) => component.id),
    args: runtime.data.context.args,
    calls,
  };

  let finished = false;
  const finish = (status: string) => {
    if (finished) return;
    finished = true;
    runtime.postMessage({ type: "status", status });
    runtime.postMessage({ type: "result", data });
  };

  runtime.postMessage({ type: "ready" });
  runtime.postMessage({ type: "status", status: "running" });
  queueMicrotask(() => finish("success"));

  return {
    stop() {
      finish("stopped");
    },
  };
}

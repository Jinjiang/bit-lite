import type { VendorDefinition, VendorRuntime, VendorStartResult } from "bit-lite-vendors";
import { wait } from "./vendor-utils.js";

export type MixedRunResult = {
  service: "mixed";
  phase: "complete";
  componentCount: number;
  summary: string;
};

export type MixedEventResult = {
  service: "mixed";
  phase: "progress";
  componentCount: number;
  detail: string;
};

export const meta: VendorDefinition = {
  id: "mixed-results",
  label: "Mixed Results",
  hint: "Sample vendor with different run and event result shapes",
  moduleUrl: import.meta.url,
};

export default async function startMixedResultsVendor(
  runtime: VendorRuntime<Record<string, unknown>, MixedEventResult>
): Promise<VendorStartResult<MixedRunResult>> {
  const componentCount = runtime.data.components.length;

  runtime.postMessage({ type: "ready" });
  runtime.postMessage({ type: "status", status: "running" });
  runtime.postMessage({
    type: "result",
    data: {
      service: "mixed",
      phase: "progress",
      componentCount,
      detail: `event saw ${componentCount} component(s)`,
    },
  });

  await wait(10);
  runtime.postMessage({ type: "status", status: "success" });

  return {
    data: {
      service: "mixed",
      phase: "complete",
      componentCount,
      summary: `run saw ${componentCount} component(s)`,
    },
  };
}

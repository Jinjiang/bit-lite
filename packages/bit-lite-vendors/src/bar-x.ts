import type { CliArguments } from "bit-lite-context";
import type {
  ServiceVendor,
  ServiceVendorCallPayload,
  ServiceVendorEventPayload,
  ServiceVendorResult,
} from "./types/index.js";

export type BarXResult = {
  service: "bar";
  vendor: "x";
  componentIds: string[];
  args: CliArguments;
  calls: string[];
};

export const barXVendor: ServiceVendor<Record<string, unknown>, CliArguments, BarXResult> = {
  name: "x",
  run(input, _context, listener) {
    const calls: string[] = [];
    let finished = false;
    let resolveResult: (result: ServiceVendorResult<BarXResult>) => void;
    const result = new Promise<ServiceVendorResult<BarXResult>>((resolve) => {
      resolveResult = resolve;
    });
    const data: BarXResult = {
      service: "bar",
      vendor: "x",
      componentIds: input.components.map((component) => component.id),
      args: input.args,
      calls,
    };

    const emit = (type: "progress" | "result", payload: ServiceVendorEventPayload) => {
      listener?.(type, payload);
    };

    const finish = (status: string) => {
      if (finished) return;
      finished = true;
      emit("result", { status, data });
      resolveResult({
        status,
        toJSON: () => data,
        toString: () => `bar/x:${status}:${data.componentIds.join(",")}`,
      });
    };

    queueMicrotask(() => finish("success"));

    return {
      result,
      abort() {
        finish("aborted");
      },
      call(type: string, payload?: ServiceVendorCallPayload) {
        calls.push(`${type}:${readCallPayload(payload)}`);
        if (type === "stop") finish("stopped");
      },
    };
  },
};

function readCallPayload(payload: ServiceVendorCallPayload | undefined) {
  if (!payload) return "";
  if (typeof payload.chunk === "string") return payload.chunk;
  if (payload.chunk instanceof Uint8Array) return new TextDecoder().decode(payload.chunk);
  if (payload.reason) return payload.reason;
  return payload.data === undefined ? "" : JSON.stringify(payload.data);
}

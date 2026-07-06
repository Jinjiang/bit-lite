import type {
  ServiceVendor,
  ServiceVendorEventPayload,
  ServiceVendorCallPayload,
  ServiceVendorResult,
} from "./types/index.js";

export type FooXResult = {
  service: "foo";
  vendor: "x";
  compList: string[];
  calls: string[];
};

export const fooXVendor: ServiceVendor<Record<string, unknown>, string[], FooXResult> = {
  name: "x",
  run(input, _context, listener) {
    // input process
    const compList = input.components.map((component) => component.id);

    // demo calls
    const calls: string[] = [];
    const emit = (type: "progress" | "result", payload: ServiceVendorEventPayload) => {
      listener?.(type, payload);
    };

    // done result and promise object
    let done = false;
    let resolveResult: (result: ServiceVendorResult<FooXResult>) => void;
    const result = new Promise<ServiceVendorResult<FooXResult>>((resolve) => {
      resolveResult = resolve;
    });
    const data: FooXResult = {
      service: "foo",
      vendor: "x",
      compList,
      calls,
    };
    const finish = (status: string) => {
      if (done) return;
      done = true;
      emit("result", { status, data });
      resolveResult({
        status,
        toJSON: () => data,
        toString: () => `foo/x:${status}:${data.compList.join(",")}`,
      });
    };

    queueMicrotask(async () => {
      await wait(1000);
      emit("progress", { status: "running", total: 3, current: 1, label: "foo x" });
      await wait(1000);
      emit("progress", { status: "running", total: 3, current: 2, label: "foo x" });
      await wait(1000);
      finish("success");
    });

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

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

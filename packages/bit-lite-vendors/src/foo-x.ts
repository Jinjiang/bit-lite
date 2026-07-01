import type {
  ServiceVendor,
  ServiceVendorEventListener,
  ServiceVendorEventType,
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
  run(input) {
    // input process
    const compList = input.components.map((component) => component.id);

    // demo listeners and calls
    const listeners = new Set<ServiceVendorEventListener>();
    const calls: string[] = [];
    const emit = (type: ServiceVendorEventType, payload: ServiceVendorEventPayload) => {
      for (const listener of listeners) listener(type, payload);
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
      emit("status", { status });
      emit("result", { status, data });
      resolveResult({
        status,
        toJSON: () => data,
        toString: () => `foo/x:${status}:${data.compList.join(",")}`,
      });
    };

    queueMicrotask(async () => {
      await wait(1000);
      emit("log", { level: "info", message: `foo/x task starting`, scope: "foo" });
      await wait(1000);
      emit("progress", { total: 3, current: 2, label: "foo x 2/3" });
      await wait(1000);
      finish("success");
    });

    return {
      result,
      listen(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      abort() {
        finish("aborted");
      },
      call(type: string, payload?: ServiceVendorCallPayload) {
        calls.push(`${type}:${readCallPayload(payload)}`);
        if (type === "stdin") emit("log", { level: "debug", message: readCallPayload(payload), scope: "foo" });
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

import type {
  ServiceVendor,
  ServiceVendorCallPayload,
  ServiceVendorEventListener,
  ServiceVendorResult,
} from "./types/index.js";

export type BarYResult = {
  service: "bar";
  vendor: "y";
  count: number;
};

export const barYVendor: ServiceVendor<Record<string, unknown>, string[], BarYResult> = {
  name: "y",
  run(input) {
    const listeners = new Set<ServiceVendorEventListener>();
    let completed = false;
    let resolveResult: (result: ServiceVendorResult<BarYResult>) => void;

    const result = new Promise<ServiceVendorResult<BarYResult>>((resolve) => {
      resolveResult = resolve;
    });

    const emit = (type: string, payload: Parameters<ServiceVendorEventListener>[1]) => {
      for (const listener of listeners) listener(type, payload);
    };

    const finish = (status: string) => {
      if (completed) return;
      completed = true;
      const data = {
        service: "bar" as const,
        vendor: "y" as const,
        count: input.components.length,
      };
      emit("status", { status });
      emit("result", { status, data });
      resolveResult({
        status,
        toJSON: () => data,
        toString: () => `bar/y:${status}:${data.count}`,
      });
    };

    setTimeout(() => {
      emit("status", { status: "running", message: "bar/y running" });
      emit("progress", { total: input.components.length || 1, current: input.components.length || 1, label: "bar y" });
      finish("success");
    }, 0);

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
        emit("log", { level: "info", message: `${type}:${payload?.reason ?? ""}`, scope: "bar" });
        if (type === "stop") finish("stopped");
      },
    };
  },
};

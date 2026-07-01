import type {
  ServiceVendor,
  ServiceVendorCallPayload,
  ServiceVendorEventListener,
  ServiceVendorResult,
} from "./types/index.js";

export type BarZResult = {
  service: "bar";
  vendor: "z";
  statusText: string;
};

export const barZVendor: ServiceVendor<Record<string, unknown>, string[], BarZResult> = {
  name: "z",
  run(input) {
    const listeners = new Set<ServiceVendorEventListener>();
    let resolveResult: (result: ServiceVendorResult<BarZResult>) => void;
    let timer: NodeJS.Timeout | undefined;
    let finished = false;
    const result = new Promise<ServiceVendorResult<BarZResult>>((resolve) => {
      resolveResult = resolve;
    });

    const emit = (type: string, payload: Parameters<ServiceVendorEventListener>[1]) => {
      for (const listener of listeners) listener(type, payload);
    };

    const finish = (status: string) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      const data = {
        service: "bar" as const,
        vendor: "z" as const,
        statusText: `${status}:${input.components.length}`,
      };
      emit("status", { status });
      emit("result", { status, data });
      resolveResult({
        status,
        toJSON: () => data,
        toString: () => `bar/z:${data.statusText}`,
      });
    };

    timer = setTimeout(() => {
      emit("status", { status: "running", message: "bar/z running" });
      emit("progress", { total: 3, current: 1, label: "bar z" });
      emit("progress", { total: 3, current: 2, label: "bar z" });
      emit("progress", { total: 3, current: 3, label: "bar z" });
      finish("success");
    }, typeof input.config.delay === "number" ? input.config.delay : 0);

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
        emit("log", { level: "debug", message: `${type}:${payload?.reason ?? ""}`, scope: "bar" });
        if (type === "stop") finish("stopped");
      },
    };
  },
};

import type {
  ServiceVendor,
  ServiceVendorCallPayload,
  ServiceVendorEventPayload,
  ServiceVendorResult,
} from "./types/index.js";

export type BarZResult = {
  service: "bar";
  vendor: "z";
  statusText: string;
};

export const barZVendor: ServiceVendor<Record<string, unknown>, string[], BarZResult> = {
  name: "z",
  run(input, _context, listener) {
    let resolveResult: (result: ServiceVendorResult<BarZResult>) => void;
    let timer: NodeJS.Timeout | undefined;
    let finished = false;
    const result = new Promise<ServiceVendorResult<BarZResult>>((resolve) => {
      resolveResult = resolve;
    });

    const emit = (type: "progress" | "result", payload: ServiceVendorEventPayload) => {
      listener?.(type, payload);
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
      emit("result", { status, data });
      resolveResult({
        status,
        toJSON: () => data,
        toString: () => `bar/z:${data.statusText}`,
      });
    };

    timer = setTimeout(() => {
      emit("progress", { status: "running", total: 3, current: 1, label: "bar z" });
      emit("progress", { status: "running", total: 3, current: 2, label: "bar z" });
      emit("progress", { status: "running", total: 3, current: 3, label: "bar z" });
      finish("success");
    }, typeof input.config.delay === "number" ? input.config.delay : 0);

    return {
      result,
      abort() {
        finish("aborted");
      },
      call(type: string, _payload?: ServiceVendorCallPayload) {
        if (type === "stop") finish("stopped");
      },
    };
  },
};

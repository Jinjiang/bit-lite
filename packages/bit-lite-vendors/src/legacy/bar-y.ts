import type {
  ServiceVendor,
  ServiceVendorCallPayload,
  ServiceVendorEventPayload,
  ServiceVendorResult,
} from "./types/index.js";

export type BarYResult = {
  service: "bar";
  vendor: "y";
  count: number;
};

export const barYVendor: ServiceVendor<Record<string, unknown>, string[], BarYResult> = {
  name: "y",
  run(input, _context, listener) {
    let completed = false;
    let resolveResult: (result: ServiceVendorResult<BarYResult>) => void;

    const result = new Promise<ServiceVendorResult<BarYResult>>((resolve) => {
      resolveResult = resolve;
    });

    const emit = (type: "progress" | "result", payload: ServiceVendorEventPayload) => {
      listener?.(type, payload);
    };

    const finish = (status: string) => {
      if (completed) return;
      completed = true;
      const data = {
        service: "bar" as const,
        vendor: "y" as const,
        count: input.components.length,
      };
      emit("result", { status, data });
      resolveResult({
        status,
        toJSON: () => data,
        toString: () => `bar/y:${status}:${data.count}`,
      });
    };

    setTimeout(() => {
      emit("progress", {
        status: "running",
        total: input.components.length || 1,
        current: input.components.length || 1,
        label: "bar y",
      });
      finish("success");
    }, 0);

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

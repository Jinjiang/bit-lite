import type {
  ServiceVendor,
  ServiceVendorCallPayload,
  ServiceVendorEventListener,
  ServiceVendorEventPayload,
  ServiceVendorEventType,
  ServiceVendorResult,
} from "./types/index.js";

export type BazXResult = {
  service: "baz";
  vendor: "x";
  mode: "single" | "watch";
  names: string[];
  run: number;
  total: number;
  passed: number;
  failed: number;
  note: string;
};

export const bazXVendor: ServiceVendor<Record<string, unknown>, string[], BazXResult> = {
  name: "x",
  run(input) {
    const mode = hasWatchParam(input.args, input.config) ? "watch" : "single";
    const names = input.components.map((component) => component.id.split("/").at(-1) ?? component.id);
    const listeners = new Set<ServiceVendorEventListener>();
    let resolveResult: (result: ServiceVendorResult<BazXResult>) => void;
    let finished = false;
    let latestWatchRun = 0;
    const timers = new Set<NodeJS.Timeout>();
    const result = new Promise<ServiceVendorResult<BazXResult>>((resolve) => {
      resolveResult = resolve;
    });

    const emit = (type: ServiceVendorEventType, payload: ServiceVendorEventPayload) => {
      for (const listener of listeners) listener(type, payload);
    };

    const finish = (status: string, data: BazXResult) => {
      if (finished) return;
      finished = true;
      clearTimers(timers);
      emit("status", { status });
      emit("result", { status, data });
      resolveResult({
        status,
        toJSON: () => data,
        toString: () => `baz/x:${data.mode}:${status}:run-${data.run}`,
      });
    };

    queueMicrotask(() => {
      if (mode === "watch") {
        schedule(timers, 5000, () => {
          latestWatchRun = 1;
          emit("result", {
            status: "watch-result",
            data: createResult(mode, names, latestWatchRun, "first watch result"),
          });
        });
        schedule(timers, 10000, () => {
          latestWatchRun = 2;
          emit("result", {
            status: "watch-result",
            data: createResult(mode, names, latestWatchRun, "second watch result"),
          });
        });
        return;
      }

      schedule(timers, 2000, () => {
        emit("log", { level: "info", message: "baz/x is still running", scope: "baz" });
        emit("progress", { total: 5, current: 2, label: "baz x" });
      });
      schedule(timers, 4000, () => {
        emit("log", { level: "info", message: "baz/x is almost done", scope: "baz" });
        emit("progress", { total: 5, current: 4, label: "baz x" });
      });
      schedule(timers, 5000, () => {
        finish("success", createResult(mode, names, 1, "single run completed"));
      });
    });

    return {
      result,
      listen(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      abort() {
        finish("aborted", createResult(mode, names, latestWatchRun, "aborted"));
      },
      call(type: string, payload?: ServiceVendorCallPayload) {
        if (type === "stdin" && mode === "watch" && isQuitInput(payload)) {
          finish("stopped", createResult(mode, names, latestWatchRun, "watch mode stopped by stdin Q"));
          return;
        }
        if (type === "stop") finish("stopped", createResult(mode, names, latestWatchRun, payload?.reason ?? "stopped"));
      },
    };
  },
};

function createResult(mode: BazXResult["mode"], names: string[], run: number, note: string): BazXResult {
  const total = Math.max(names.length, 1);
  const failed = mode === "watch" && run === 2 ? 1 : 0;
  return {
    service: "baz",
    vendor: "x",
    mode,
    names,
    run,
    total,
    passed: Math.max(total - failed, 0),
    failed,
    note,
  };
}

function hasWatchParam(args: string[], config: Record<string, unknown>) {
  if (config.watch === true) return true;
  return args.some((arg) => arg === "watch" || arg === "--watch" || arg === "-w" || arg === "watch=true" || arg === "--watch=true");
}

function isQuitInput(payload: ServiceVendorCallPayload | undefined) {
  return readCallPayload(payload).trim().toUpperCase() === "Q";
}

function readCallPayload(payload: ServiceVendorCallPayload | undefined) {
  if (!payload) return "";
  if (typeof payload.chunk === "string") return payload.chunk;
  if (payload.chunk instanceof Uint8Array) return new TextDecoder().decode(payload.chunk);
  if (payload.reason) return payload.reason;
  return payload.data === undefined ? "" : JSON.stringify(payload.data);
}

function schedule(timers: Set<NodeJS.Timeout>, delay: number, callback: () => void) {
  const timer = setTimeout(() => {
    timers.delete(timer);
    callback();
  }, delay);
  timers.add(timer);
}

function clearTimers(timers: Set<NodeJS.Timeout>) {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
}

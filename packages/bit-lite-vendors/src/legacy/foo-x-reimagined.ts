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
  run(input, _context, connector) {
    const compList = input.components.map((component) => component.id);

    const calls: string[] = [];
    const data: FooXResult = {
      service: "foo",
      vendor: "x",
      compList,
      calls,
    };

    let status: string = "";

    connector.onAll((payload, type) => calls.push(`${type}:${readCallPayload(payload)}`));

    status = "running";

    await wait(1000);
    connector.emit("progress", { status, total: 3, current: 1, label: "foo x" });
    await wait(1000);
    connector.emit("progress", { status, total: 3, current: 2, label: "foo x" });
    await wait(1000);

    status = "finished";
    connector.emit("progress", { status, total: 3, current: 3, label: "foo x" });

    const result = {
      status,
      data,
      toJSON: () => data,
      toString: () => `foo/x:${status}:${data.compList.join(",")}`,
    };
    connector.emit("result", { status, data: result });

    return result;
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

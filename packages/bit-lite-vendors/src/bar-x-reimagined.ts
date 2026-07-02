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
  compList: string[];
  args: CliArguments;
  calls: string[];
};

export const barXVendor: ServiceVendor<Record<string, unknown>, CliArguments, BarXResult> = {
  name: "x",
  run(input, _context, listener) {
    const compList = input.components.map((component) => component.id);

    const calls: string[] = [];
    const data: BarXResult = {
      service: "bar",
      vendor: "x",
      compList,
      args: input.args,
      calls,
    };

    let status: string = "";

    const server = createServer(input.args.port)

    connector.onAll((payload, type) => calls.push(`${type}:${readCallPayload(payload)}`));
    connector.on("stop", (reason) => {
      server.stop();
      status = "stopped";
      connector.emit("progress", { status, message: reason });
    });

    status = "running";
    connector.emit("progress", { status, message: server.port });

    const result = {
      status,
      data: { port },
      toJSON: () => { port },
      toString: () => `Server is running at port: ${server.port}`
    }

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

function createServer(port: number) {
  // TODO: impl a simple http server
  // 1. at port or incremented one if occupied
  // 2. can be stopped
  return {
    port: port + 1,
    stop: () => {}
  }
}

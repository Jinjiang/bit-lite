import type { CliArguments } from "bit-lite-context";
import type {
  ServiceVendor,
  ServiceVendorCallPayload,
  ServiceVendorEventPayload,
  ServiceVendorResult,
} from "./types/index.js";

export type BazXResult = {
  service: "baz";
  vendor: "x";
  compList: string[];
  args: CliArguments;
  calls: string[];
};

export const bazXVendor: ServiceVendor<Record<string, unknown>, string[], BazXResult> = {
  name: "x",
  run(input, _context, listener) {
    const compList = input.components.map((component) => component.id);

    const calls: string[] = [];
    const data: BarXResult = {
      service: "baz",
      vendor: "x",
      compList,
      args: input.args,
      calls,
    };

    let status: string = "";

    connector.onAll((payload, type) => calls.push(`${type}:${readCallPayload(payload)}`));

    if (input.args.watch) {
      const tester = createTester(true)
      status = "watching";
      connector.emit("progress", { status });
      connector.on("stop", (reason) => {
        tester.stop();
        status = "stopped";
        connector.emit("progress", { status, message: reason });
      });
      tester.on("update", result => {
        connector.emit("result", {
          status,
          data: result,
          toJSON: () => result,
          toString: () => summarize(result)
        })
      })
      return {
        status,
        data: {},
        toJSON: () => {},
        toString: () => `Tester is running`
      }
    }

    const tester = createTester()
    const result = await tester.run()

    return {
      status,
      data: result,
      toJSON: () => result,
      toString: () => summarize(result)
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

function createTester(_watch: boolean) {
  // TODO: impl a simple tester
  // 1. can run and async return result
  // 2. can be stopped
  return {
    run: () => Promise.resolve({})
    stop: () => {}
  }
}

function summarize(_result) {
  // TODO: impl
  return ""
}

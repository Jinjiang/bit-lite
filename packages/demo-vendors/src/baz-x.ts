import { parseCliArguments } from "bit-lite-context";
import { bazXVendor } from "bit-lite-vendors";
import { createDemoInput } from "./runtime.js";
import { reportDemoError, runVendorDemo } from "./run-demo.js";

async function main() {
  await runVendorDemo({
    title: "BazX",
    vendor: bazXVendor,
    input: createDemoInput({
      serviceName: "baz",
      config: {},
      args: parseCliArguments([]),
      componentIds: ["components/demo/baz-gamma"],
    }),
  });
}

main().catch(reportDemoError);

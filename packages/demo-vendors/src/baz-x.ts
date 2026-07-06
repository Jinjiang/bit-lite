import { parseCliArguments } from "bit-lite-context";
import { meta as bazXVendor } from "bit-lite-vendors/sample/baz-x";
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

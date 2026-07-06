import { parseCliArguments } from "bit-lite-context";
import { meta as barXVendor } from "bit-lite-vendors/sample/bar-x";
import { createDemoInput } from "./runtime.js";
import { reportDemoError, runVendorDemo } from "./run-demo.js";

async function main() {
  await runVendorDemo({
    title: "BarX",
    vendor: barXVendor,
    input: createDemoInput({
      serviceName: "bar",
      config: {},
      args: parseCliArguments([]),
      componentIds: ["components/demo/bar-beta"],
    }),
  });
}

main().catch(reportDemoError);

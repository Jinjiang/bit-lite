import { parseCliArguments } from "bit-lite-context";
import { barXVendor } from "bit-lite-vendors";
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

import { bazXVendor } from "bit-lite-vendors";
import { createDemoInput } from "./runtime.js";
import { reportDemoError, runVendorDemo } from "./run-demo.js";

async function main() {
  await runVendorDemo({
    title: "BazX single",
    vendor: bazXVendor,
    input: createDemoInput({
      serviceName: "baz",
      config: {},
      args: [],
      componentIds: ["components/demo/baz-gamma"],
    }),
  });

  await runVendorDemo({
    title: "BazX watch",
    vendor: bazXVendor,
    input: createDemoInput({
      serviceName: "baz",
      config: {
        watch: true,
      },
      args: ["watch"],
      componentIds: ["components/demo/baz-gamma"],
    }),
    beforeResult(task) {
      setTimeout(() => {
        console.log("stdin: Q");
        task.call("stdin", { chunk: "Q\n" });
      }, 11000);
    },
  });
}

main().catch(reportDemoError);

import { parseCliArguments } from "bit-lite-context";
import { fooXVendor } from "bit-lite-vendors";
import { createDemoInput } from "./runtime.js";
import { reportDemoError, runVendorDemo } from "./run-demo.js";

async function main() {
  await runVendorDemo({
    title: "FooX",
    vendor: fooXVendor,
    input: createDemoInput({
      serviceName: "foo",
      config: {
        label: "foo x demo",
      },
      args: parseCliArguments(["--demo", "foo-x"]),
      componentIds: ["components/demo/foo-alpha"],
    }),
  });
}

main().catch(reportDemoError);

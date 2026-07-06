import { parseCliArguments } from "bit-lite-context";
import { meta as fooXVendor } from "bit-lite-vendors/sample/foo-x";
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

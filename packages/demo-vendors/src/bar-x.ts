import { barXVendor } from "bit-lite-vendors";
import { createDemoInput } from "./runtime.js";
import { delay, reportDemoError, runVendorDemo } from "./run-demo.js";

async function main() {
  await runVendorDemo({
    title: "BarX",
    vendor: barXVendor,
    input: createDemoInput({
      serviceName: "bar",
      config: {
        port: 43100,
      },
      args: ["--port", "43100"],
      componentIds: ["components/demo/bar-beta"],
    }),
    async afterResult(task, result) {
      const data = result.toJSON();
      if (!data.url) return;

      console.log(`request: GET ${data.url}/demo/bar-x`);
      const response = await fetch(`${data.url}/demo/bar-x`);
      console.log(`response: ${response.status} ${await response.text()}`);
      await delay(100);

      task.call("stop", { reason: "demo finished" });
      await delay(100);
    },
  });
}

main().catch(reportDemoError);

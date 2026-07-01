import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
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
      await waitForQuitInput();

      task.call("stop", { reason: "demo finished" });
      await delay(100);
    },
  });
}

async function waitForQuitInput() {
  const reader = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const answer = await reader.question("type q and press Enter to stop BarX server: ");
      if (answer.trim().toLowerCase() === "q") return;
    }
  } finally {
    reader.close();
  }
}

main().catch(reportDemoError);

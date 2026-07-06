import { parseCliArguments } from "bit-lite-context";
import { runService, testService } from "bit-lite-services";
import { demoWorkspaceRuntime } from "./runtime.js";
import { reportDemoError } from "./run-demo.js";

async function main() {
  const rawArgs = process.argv.slice(2);
  const args = parseCliArguments(rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs);
  const autoStopMs = Number.parseInt(process.env.DEMO_TEST_SERVICE_AUTO_STOP_MS ?? "", 10);
  const result = await runService({
    service: testService,
    input: {
      components: demoWorkspaceRuntime.components.map(({ id, rootDir }) => ({ id, rootDir })),
      config: {},
      args,
      context: demoWorkspaceRuntime,
    },
    terminal: {
      autoStopMs: Number.isFinite(autoStopMs) ? autoStopMs : undefined,
    },
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch(reportDemoError);

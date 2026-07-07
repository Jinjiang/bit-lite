import { parseCliArguments } from "bit-lite-context";
import { testService } from "bit-lite-services";
import { demoWorkspaceRuntime } from "./runtime.js";
import { reportDemoError } from "./run-demo.js";

async function main() {
  const rawArgs = process.argv.slice(2);
  const args = parseCliArguments(rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs);
  await testService.run({
    components: demoWorkspaceRuntime.components.map(({ id, rootDir }) => ({ id, rootDir })),
    args,
    context: demoWorkspaceRuntime,
  });
}

main().catch(reportDemoError);

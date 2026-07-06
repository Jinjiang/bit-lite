import { loadWorkspace, parseArgs } from "bit-lite-context";
import { runService, testService } from "bit-lite-services";
import type { JsonValue, ServiceResult } from "bit-lite-services";
import { BitLiteError } from "./utils/errors.js";

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.help || !parsed.command) {
    printUsage();
    return 0;
  }

  try {
    if (parsed.command === "test") {
      const workspace = await loadWorkspace(parsed.workspaceRoot);
      const result = await runService({
        service: testService,
        input: {
          components: workspace.components.map(({ id, rootDir }) => ({ id, rootDir })),
          config: {},
          args: parsed.args,
          context: workspace,
        },
        terminal: {
          // Watch mode normally runs until the user quits. This env-only
          // escape hatch lets non-interactive checks exercise watch mode
          // without hanging forever.
          autoStopMs: readAutoStopMs(),
        },
      });

      printServiceResult(result);
      return hasFailedTestResult(result) ? 1 : 0;
    }

    throw new BitLiteError(`command "${parsed.command}" is not registered in this clean-slate build`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}

function printUsage() {
  console.log(`bit-lite

Usage:
  bit-lite --help
  bit-lite <command> [--workspace <dir>] [...args]

Commands:
  test    run the configured test service
`);
}

function printServiceResult(result: ServiceResult) {
  console.log(JSON.stringify(result, null, 2));
}

function hasFailedTestResult(result: ServiceResult) {
  return result.results.some((taskResult) => {
    const data = taskResult.data;
    return isJsonObject(data) && typeof data.failed === "number" && data.failed > 0;
  });
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// This is intentionally not workspace service config. It is only for tests and
// local verification that need watch-mode services to stop on their own.
function readAutoStopMs() {
  const value = Number.parseInt(process.env.BIT_LITE_SERVICE_AUTO_STOP_MS ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

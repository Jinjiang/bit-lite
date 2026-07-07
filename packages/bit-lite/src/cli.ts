import { parseArgs } from "bit-lite-context";
import { runTestCommand } from "./commands/test.js";
import type { ParsedCliArgs } from "bit-lite-context";
import { BitLiteError } from "./utils/errors.js";

type CommandHandler = (parsed: ParsedCliArgs) => void | Promise<void>;

const commands: Record<string, CommandHandler> = {
  test: runTestCommand,
};

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.help || !parsed.command) {
    printUsage();
    return 0;
  }

  try {
    const command = commands[parsed.command];
    if (command) {
      await command(parsed);
      return 0;
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
  bit-lite <command> [--workspace <dir>] [--filter <component-pattern>] [...args]

Commands:
  test    run the configured test service
`);
}

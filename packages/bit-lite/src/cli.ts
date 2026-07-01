import path from "node:path";
import { BitLiteError } from "./utils/errors.js";

export type ParsedCliArgs = {
  command: string | undefined;
  args: string[];
  workspaceRoot: string;
  help: boolean;
};

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.help || !parsed.command) {
    printUsage();
    return 0;
  }

  try {
    throw new BitLiteError(`command "${parsed.command}" is not registered in this clean-slate build`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}

export function parseArgs(argv: string[]): ParsedCliArgs {
  const remaining: string[] = [];
  let workspaceRoot = process.cwd();
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--workspace" || arg === "-w") {
      const value = argv[index + 1];
      if (!value) throw new BitLiteError("--workspace requires a path");
      workspaceRoot = path.resolve(value);
      index += 1;
    } else {
      remaining.push(arg);
    }
  }

  return {
    command: remaining[0],
    args: remaining.slice(1),
    workspaceRoot,
    help,
  };
}

function printUsage() {
  console.log(`bit-lite

Usage:
  bit-lite --help
  bit-lite <command> [--workspace <dir>] [...args]

No built-in commands are registered in this clean-slate build.
`);
}

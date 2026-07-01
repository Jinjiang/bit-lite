import path from "node:path";
import { BitLiteError } from "./utils/errors.js";
import type { ParsedCliArgs } from "./types/index.js";

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

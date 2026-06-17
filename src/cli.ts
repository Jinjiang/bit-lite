import path from "node:path";
import { commands } from "./commands/index.js";
import { loadWorkspace } from "./context/workspace.js";
import { BitLiteError } from "./utils/errors.js";
import { matchPattern } from "./utils/patterns.js";
import type { WorkspaceRuntime } from "./types/index.js";

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.help || !parsed.command) {
    printUsage();
    return 0;
  }

  try {
    const loadedWorkspace = await loadWorkspace(parsed.workspaceRoot);
    const workspace = parsed.filterPattern ? filterWorkspace(loadedWorkspace, parsed.filterPattern) : loadedWorkspace;
    const command = commands[parsed.command];
    if (!command) throw new BitLiteError(`unknown command "${parsed.command}"`);
    return await command.run({
      workspace,
      args: parsed.args,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}

type ParsedArgs = {
  command: string | undefined;
  args: string[];
  workspaceRoot: string;
  filterPattern: string | undefined;
  help: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const remaining: string[] = [];
  let workspaceRoot = process.cwd();
  let filterPattern: string | undefined;
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
    } else if (arg === "--filter") {
      const value = argv[index + 1];
      if (!value) throw new BitLiteError("--filter requires a pattern");
      filterPattern = value;
      index += 1;
    } else {
      remaining.push(arg);
    }
  }

  if (remaining[0] === "run") {
    return {
      command: remaining[1],
      args: remaining.slice(2),
      workspaceRoot,
      filterPattern,
      help,
    };
  }

  return {
    command: remaining[0],
    args: remaining.slice(1),
    workspaceRoot,
    filterPattern,
    help,
  };
}

function printUsage() {
  console.log(`bit-lite

Usage:
  bit-lite components [--workspace <dir>] [--filter <pattern>]
  bit-lite envs [--workspace <dir>]
  bit-lite inspect [--workspace <dir>] [--filter <pattern>]
  bit-lite typecheck [--workspace <dir>] [--filter <pattern>]
  bit-lite test [--workspace <dir>] [--filter <pattern>] [--watch]
  bit-lite preview [--workspace <dir>] [--filter <pattern>]
  bit-lite start [--workspace <dir>] [--filter <pattern>]

Compatibility:
  bit-lite run <service> [--workspace <dir>] [--filter <pattern>] [...service args]
`);
}

function filterWorkspace(workspace: WorkspaceRuntime, pattern: string): WorkspaceRuntime {
  const components = workspace.components.filter((component) => matchPattern(component.id, pattern));
  const componentIds = new Set(components.map((component) => component.id));
  const groups = workspace.groups
    .map((group) => ({
      ...group,
      components: group.components.filter((component) => componentIds.has(component.id)),
    }))
    .filter((group) => group.components.length > 0);

  return {
    ...workspace,
    components,
    groups,
  };
}

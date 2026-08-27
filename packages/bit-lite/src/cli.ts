import { parseArgs } from "bit-lite-context";
import { runCompileCommand } from "./commands/compile.js";
import { runLinkCommand } from "./commands/link.js";
import { runInstallCommand } from "./commands/install.js";
import { runPreviewCommand } from "./commands/preview.js";
import { runSnapCommand } from "./commands/snap.js";
import { runStartCommand } from "./commands/start.js";
import { runSyncCommand } from "./commands/sync.js";
import { runTagCommand } from "./commands/tag.js";
import { runTestCommand } from "./commands/test.js";
import { runWatchCommand } from "./commands/watch.js";
import type { ParsedCliArgs } from "bit-lite-context";
import { BitLiteError } from "./utils/errors.js";

type CommandHandler = (parsed: ParsedCliArgs) => void | Promise<void>;

const commands: Record<string, CommandHandler> = {
  compile: runCompileCommand,
  install: runInstallCommand,
  link: runLinkCommand,
  preview: runPreviewCommand,
  // The snap runner returns a structured report for callers and tests; the CLI
  // only needs the side effect and its own exit code.
  snap: async (parsed) => {
    await runSnapCommand(parsed);
  },
  start: runStartCommand,
  sync: async (parsed) => {
    await runSyncCommand(parsed);
  },
  tag: async (parsed) => {
    await runTagCommand(parsed);
  },
  test: runTestCommand,
  watch: runWatchCommand,
};

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.help || !parsed.command) {
      printUsage();
      return 0;
    }

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
  compile compile component packages once or watch with vendor-owned --watch
  install install/link packages and optionally compile once with --compile
  preview serve component docs and compositions
  snap    record selected components in the component history store
  start   compile and serve preview/live tests in one watch session
  sync    exchange component histories and tags with [--remote <url>]
  tag     assign an immutable --version <semver> to one component's snap
  test    run the configured test service
  watch   alias for compile --watch
`);
}

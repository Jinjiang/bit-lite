import { parseArgs } from "bit-lite-context";
import { runCompileCommand } from "./commands/compile.js";
import { runLinkCommand } from "./commands/link.js";
import { runLogCommand } from "./commands/log.js";
import { runInstallCommand } from "./commands/install.js";
import { runPreviewCommand } from "./commands/preview.js";
import { runSnapCommand } from "./commands/snap.js";
import { runStartCommand } from "./commands/start.js";
import { runStatusCommand } from "./commands/status.js";
import { runSyncCommand } from "./commands/sync.js";
import { runTagCommand } from "./commands/tag.js";
import { runTestCommand } from "./commands/test.js";
import { runWatchCommand } from "./commands/watch.js";
import type { ParsedCliArgs } from "bit-lite-context";
import { BitLiteError } from "./utils/errors.js";

type CommandHandler = (parsed: ParsedCliArgs) => void | Promise<unknown>;

const commands: Record<string, CommandHandler> = {
  compile: runCompileCommand,
  install: runInstallCommand,
  link: runLinkCommand,
  log: runLogCommand,
  preview: runPreviewCommand,
  snap: runSnapCommand,
  start: runStartCommand,
  status: runStatusCommand,
  sync: runSyncCommand,
  tag: runTagCommand,
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
  log     list one component's recorded snaps with the versions on each and
          why each version exists [--json]
  preview serve component docs and compositions
  snap    record selected components in the component history store
          [--message <text>] [--dry-run] [--json]
  start   compile and serve preview/live tests in one watch session
  status  report each selected component's state against its recorded history
          [--json]
  sync    exchange component histories and tags with [--remote <url>]
  tag     assign immutable versions to the selected components' snaps,
          incrementing each component's patch by default
          [--version <x.y.z>, one component only] [--message <text>] [--dry-run] [--json]
  test    run the configured test service
  watch   alias for compile --watch
`);
}

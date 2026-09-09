import { parseArgs } from "./args.js";
import { runCompileCommand } from "./commands/compile.js";
import { commandDeclarations, findCommandDeclaration } from "./commands/declarations.js";
import { renderCommandHelp, renderCommandList } from "./commands/help-text.js";
import { runDiffCommand } from "./commands/diff.js";
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
import type { ParsedCliArgs } from "./cli-args-types.js";
import { BitLiteError } from "bit-lite-utils";

type CommandHandler = (parsed: ParsedCliArgs) => void | Promise<unknown>;

/**
 * One handler per declared command. `help` has no handler because a help
 * request is answered before dispatch — asking about a command must never run
 * it. `commandHandlers` and the declaration table are kept in step by a test
 * rather than by remembering.
 */
export const commandHandlers: Record<string, CommandHandler> = {
  compile: runCompileCommand,
  diff: runDiffCommand,
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

    if (parsed.help.kind === "list") {
      console.log(renderCommandList(commandDeclarations));
      return 0;
    }
    if (parsed.help.kind === "command") {
      const declaration = findCommandDeclaration(parsed.help.command);
      if (!declaration) throw unknownCommand(parsed.help.command);
      console.log(renderCommandHelp(declaration));
      return 0;
    }

    const command = parsed.command === undefined ? undefined : commandHandlers[parsed.command];
    if (command) {
      await command(parsed);
      return 0;
    }

    throw unknownCommand(parsed.command ?? "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}

function unknownCommand(name: string) {
  const known = commandDeclarations.map((declaration) => declaration.name).join(", ");
  return new BitLiteError(`Unknown command "${name}". Available commands: ${known}.`);
}

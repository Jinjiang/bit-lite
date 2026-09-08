import type { CliArguments } from "bit-lite-utils";

/**
 * What one CLI invocation parsed into. Unlike `CliArguments`, which travels to
 * vendors, this shape exists only between the parser and the command it
 * dispatches to, so it lives with the CLI.
 */
export type ParsedCliArgs = {
  command: string | undefined;
  args: CliArguments;
  workspaceRoot: string;
  componentFilters: string[];
  help: boolean;
};

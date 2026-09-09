import type { CliArguments } from "bit-lite-utils";

/**
 * What the user asked for help about. `list` is the global command list;
 * `command` names one command, whether it was reached through `<command> -h`,
 * `<command> --help`, or `help <command>`.
 */
export type HelpRequest =
  | { kind: "none" }
  | { kind: "list" }
  | { kind: "command"; command: string };

/**
 * A bare word an undeclared option consumed as its value. Whether that was
 * right depends on a vendor option the CLI cannot see, so the parser records
 * the pair and the selection path decides later, once the registered component
 * IDs are known.
 */
export type ConsumedBareWord = {
  /** As the user spelled it, e.g. `--verbose`. */
  option: string;
  value: string;
};

/**
 * What one CLI invocation parsed into. Unlike `CliArguments`, which travels to
 * vendors, this shape exists only between the parser and the command it
 * dispatches to, so it lives with the CLI.
 */
export type ParsedCliArgs = {
  command: string | undefined;
  args: CliArguments;
  workspaceRoot: string;
  /**
   * Every component pattern this invocation named, whether written as `--filter`
   * or positionally. The two spellings are equivalent and combine here.
   */
  componentFilters: string[];
  help: HelpRequest;
  consumedBareWords: readonly ConsumedBareWord[];
};

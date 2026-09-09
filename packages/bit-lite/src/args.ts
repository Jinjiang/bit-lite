import path from "node:path";
import yargsParser from "yargs-parser";
import { BitLiteError } from "bit-lite-utils";
import {
  effectiveCommandOptions,
  findCommandDeclaration,
  globalCommandOptions,
} from "./commands/declarations.js";
import type { CommandDeclaration, CommandOption } from "./commands/declarations.js";
import type { ConsumedBareWord, HelpRequest, ParsedCliArgs } from "./cli-args-types.js";
import type { CliArguments, CliOptionScalar, CliOptionValue } from "bit-lite-utils";

type ParsedArgv = ReturnType<typeof yargsParser>;

const sharedConfiguration = {
  "camel-case-expansion": false,
  "dot-notation": false,
  "parse-positional-numbers": false,
  "populate--": true,
  "strip-aliased": true,
} as const;

/**
 * Enough to find the command name and nothing more. Which options exist depends
 * on which command is running, so the first pass declares only what is true of
 * every invocation.
 */
const globalParserOptions = {
  alias: { help: ["h"], workspace: ["w"] },
  boolean: ["help"],
  string: ["workspace", "filter"],
  configuration: sharedConfiguration,
} satisfies Parameters<typeof yargsParser>[1];

const globalOptionNames = new Set(Object.keys(globalCommandOptions));

export function parseArgs(argv: string[]): ParsedCliArgs {
  const firstPass = yargsParser(argv, globalParserOptions);
  const leadingPositionals = firstPass._.map(String);
  const command = leadingPositionals[0];

  // Global options are malformed independently of which command is running, so
  // they are reported even when the line is otherwise a help request.
  const globals = readOptions(firstPass);
  readWorkspaceRoot(globals.workspace);
  readComponentFilters(globals.filter);

  const help = resolveHelpRequest(command, leadingPositionals[1], firstPass.help === true);
  // A help request outranks everything else on the line, including arguments
  // the command would reject: help is what answers the mistake.
  if (help.kind !== "none") return helpOnlyResult(argv, command, help);

  const declaration = command === undefined ? undefined : findCommandDeclaration(command);
  // An unrecognized command cannot be parsed against a declaration; dispatch
  // reports it with the list of commands that do exist.
  if (declaration === undefined) return helpOnlyResult(argv, command, help);

  const options = effectiveCommandOptions(declaration);
  const scannable = argvBeforePassthrough(argv);
  assertFlagValuesAreBoolean(scannable, options);

  const argvResult = yargsParser(argv, commandParserOptions(declaration));
  const parsedOptions = readOptions(argvResult);

  // Naming components to a command that has none is one mistake with one
  // message, whether it was written positionally or as --filter. It is checked
  // before the unknown-option rule so that --filter does not get reported as
  // merely unrecognized on the commands that reject unknown options.
  const positionals = argvResult._.map(String).slice(1);
  const componentFilters = readSelection(declaration, parsedOptions.filter, positionals);

  assertOptionsAreKnown(parsedOptions, declaration, options);

  return {
    command,
    args: {
      raw: [...argv],
      options: readCommandOptions(parsedOptions),
      passthrough: readPassthrough(argvResult),
    },
    workspaceRoot: readWorkspaceRoot(parsedOptions.workspace),
    componentFilters,
    help,
    consumedBareWords:
      declaration.unknownOptions === "forward" ? findConsumedBareWords(scannable, options) : [],
  };
}

function resolveHelpRequest(
  command: string | undefined,
  helpTarget: string | undefined,
  helpFlag: boolean
): HelpRequest {
  if (command === "help") {
    return helpTarget === undefined ? { kind: "list" } : { kind: "command", command: helpTarget };
  }
  if (helpFlag) {
    return command === undefined ? { kind: "list" } : { kind: "command", command };
  }
  if (command === undefined) return { kind: "list" };
  return { kind: "none" };
}

/**
 * Everything a help request or an unknown command needs. Neither runs a
 * command, so neither validates a workspace, a selection, or an option.
 */
function helpOnlyResult(
  argv: readonly string[],
  command: string | undefined,
  help: HelpRequest
): ParsedCliArgs {
  return {
    command,
    args: { raw: [...argv], options: {}, passthrough: [] },
    workspaceRoot: process.cwd(),
    componentFilters: [],
    help,
    consumedBareWords: [],
  };
}

/**
 * Only flags need declaring to `yargs-parser`: a flag must not swallow the bare
 * word after it, which is how a positional component pattern survives. Values
 * are left undeclared so they keep consuming the next word, and keep the types
 * they have always had — `--port 3000` stays a number.
 */
function commandParserOptions(declaration: CommandDeclaration) {
  const options = effectiveCommandOptions(declaration);
  const alias: Record<string, string[]> = {};
  const boolean: string[] = [];
  for (const [name, option] of Object.entries(options)) {
    if (option.alias) alias[name] = [...option.alias];
    if (option.kind === "flag") boolean.push(name);
  }
  return {
    alias,
    boolean,
    string: ["workspace", "filter"],
    configuration: sharedConfiguration,
  } satisfies Parameters<typeof yargsParser>[1];
}

/** Tokens the user meant for this CLI, stopping where vendor passthrough starts. */
function argvBeforePassthrough(argv: readonly string[]): string[] {
  const end = argv.indexOf("--");
  return end === -1 ? [...argv] : argv.slice(0, end);
}

function assertFlagValuesAreBoolean(
  argv: readonly string[],
  options: Readonly<Record<string, CommandOption>>
) {
  for (const token of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (!match) continue;
    const [, name, value] = match as unknown as [string, string, string];
    if (options[name]?.kind !== "flag") continue;
    if (value !== "true" && value !== "false") {
      throw new BitLiteError(`--${name} requires a boolean value`);
    }
  }
}

function assertOptionsAreKnown(
  parsedOptions: CliArguments["options"],
  declaration: CommandDeclaration,
  options: Readonly<Record<string, CommandOption>>
) {
  if (declaration.unknownOptions === "forward") return;
  const unknown = Object.keys(parsedOptions).filter((name) => options[name] === undefined);
  if (unknown.length === 0) return;
  const spellings = unknown.map(spell).join(", ");
  const known = Object.keys(options).map(spell).join(", ");
  throw new BitLiteError(
    `Unrecognized option${unknown.length === 1 ? "" : "s"} for "${declaration.name}": ${spellings}. ` +
      `${declaration.name} accepts ${known}.`
  );
}

/**
 * Records each bare word an undeclared option consumed. `yargs-parser` gives an
 * undeclared option the next token, which is right for a vendor option and its
 * value and wrong when the token was a component. Nothing here can tell those
 * apart; the selection path can, once it knows the component IDs.
 */
function findConsumedBareWords(
  argv: readonly string[],
  options: Readonly<Record<string, CommandOption>>
): ConsumedBareWord[] {
  const declared = declaredSpellings(options);
  const consumed: ConsumedBareWord[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith("-") || token.includes("=")) continue;
    const name = token.replace(/^--?/, "");
    if (name.length === 0 || declared.has(name)) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("-")) continue;
    consumed.push({ option: token, value: next });
    index += 1;
  }
  return consumed;
}

function spell(name: string): string {
  return name.length === 1 ? `-${name}` : `--${name}`;
}

/** Every name a declared option answers to, long form and aliases alike. */
function declaredSpellings(options: Readonly<Record<string, CommandOption>>): Set<string> {
  const names = new Set<string>();
  for (const [name, option] of Object.entries(options)) {
    names.add(name);
    for (const alias of option.alias ?? []) names.add(alias);
  }
  return names;
}

/**
 * Positional patterns are the other spelling of `--filter`, so they land in the
 * same list. Order between the two is unobservable: selection is a union and
 * components come back in canonical workspace order either way.
 */
function readSelection(
  declaration: CommandDeclaration,
  filterValue: CliOptionValue | undefined,
  positionals: readonly string[]
): string[] {
  const filters = readComponentFilters(filterValue);
  if (declaration.selection === "components") return [...filters, ...positionals];
  const named = [...positionals, ...filters.map((filter) => `--filter ${filter}`)];
  if (named.length > 0) {
    throw new BitLiteError(
      `${declaration.name} operates on the whole workspace and does not select components, ` +
        `so it does not accept ${named.join(", ")}. ` +
        `Place vendor arguments after --.`
    );
  }
  return [];
}

function readWorkspaceRoot(value: CliOptionValue | undefined): string {
  if (value === undefined) return process.cwd();
  if (typeof value !== "string" || value.length === 0) {
    throw new BitLiteError("--workspace requires a path");
  }
  return path.resolve(value);
}

function readComponentFilters(value: CliOptionValue | undefined): string[] {
  if (value === undefined) return [];
  const filters = Array.isArray(value) ? value : [value];
  if (!filters.every((filter): filter is string => typeof filter === "string" && filter.length > 0)) {
    throw new BitLiteError("--filter requires a component pattern");
  }
  return filters;
}

function readCommandOptions(options: CliArguments["options"]): CliArguments["options"] {
  const commandOptions: CliArguments["options"] = {};
  for (const [name, value] of Object.entries(options)) {
    if (!globalOptionNames.has(name)) commandOptions[name] = value;
  }
  return commandOptions;
}

function readOptions(parsed: ParsedArgv): CliArguments["options"] {
  const options: CliArguments["options"] = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (name === "_" || name === "--" || name === "$0") continue;
    if (value === undefined) continue;
    options[name] = normalizeOptionValue(name, value);
  }
  return options;
}

function readPassthrough(parsed: ParsedArgv): string[] {
  return Array.isArray(parsed["--"]) ? parsed["--"].map(String) : [];
}

function normalizeOptionValue(name: string, value: unknown): CliOptionValue {
  if (isCliOptionScalar(value)) return value;
  if (Array.isArray(value) && value.every(isCliOptionScalar)) return value;
  throw new BitLiteError(`Unsupported value for CLI option "${name}"`);
}

function isCliOptionScalar(value: unknown): value is CliOptionScalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

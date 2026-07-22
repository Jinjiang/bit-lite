import path from "node:path";
import yargsParser from "yargs-parser";
import { BitLiteError } from "./utils/errors.js";
import type { CliArguments, CliOptionScalar, CliOptionValue, ParsedCliArgs } from "./types/index.js";

type ParsedArgv = ReturnType<typeof yargsParser>;

const parserOptions = {
  alias: {
    help: ["h"],
    workspace: ["w"],
  },
  boolean: ["help"],
  string: ["workspace", "filter"],
  configuration: {
    "camel-case-expansion": false,
    "dot-notation": false,
    "parse-positional-numbers": false,
    "populate--": true,
    "strip-aliased": true,
  },
} satisfies Parameters<typeof yargsParser>[1];

const globalOptionNames = new Set(["help", "workspace", "filter"]);

export function parseCliArguments(argv: string[]): CliArguments {
  const parsed = parseArgv(argv);
  const positional = parsed._.map(String);
  if (positional.length > 0) throw unsupportedPositionals(positional);

  return {
    raw: [...argv],
    options: readOptions(parsed),
    passthrough: readPassthrough(parsed),
  };
}

export function parseArgs(argv: string[]): ParsedCliArgs {
  const argvResult = parseArgv(argv);
  const positional = argvResult._.map(String);
  const command = positional[0];
  if (positional.length > 1) throw unsupportedPositionals(positional.slice(1));
  const options = readOptions(argvResult);
  const workspaceRoot = readWorkspaceRoot(options.workspace);
  const componentFilters = readComponentFilters(options.filter);

  return {
    command,
    args: {
      raw: [...argv],
      options: readCommandOptions(options),
      passthrough: readPassthrough(argvResult),
    },
    workspaceRoot,
    componentFilters,
    help: options.help === true,
  };
}

function parseArgv(argv: string[]) {
  return yargsParser(argv, parserOptions);
}

function unsupportedPositionals(values: string[]) {
  return new BitLiteError(
    `Unsupported positional argument${values.length === 1 ? "" : "s"}: ${values.join(", ")}. ` +
    `Use --filter for component selection or place vendor arguments after --.`
  );
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

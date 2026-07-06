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
  string: ["workspace"],
  configuration: {
    "camel-case-expansion": false,
    "dot-notation": false,
    "parse-positional-numbers": false,
    "populate--": true,
    "strip-aliased": true,
  },
} satisfies Parameters<typeof yargsParser>[1];

const globalOptionNames = new Set(["help", "workspace"]);

export function parseCliArguments(argv: string[]): CliArguments {
  const parsed = yargsParser(argv, parserOptions);

  return {
    raw: [...argv],
    positional: parsed._.map(String),
    options: readOptions(parsed),
    passthrough: readPassthrough(parsed),
  };
}

export function parseArgs(argv: string[]): ParsedCliArgs {
  const parsed = parseCliArguments(argv);
  const workspaceRoot = readWorkspaceRoot(parsed.options.workspace);
  const command = parsed.positional[0];

  return {
    command,
    args: {
      raw: parsed.raw,
      positional: parsed.positional.slice(1),
      options: readCommandOptions(parsed.options),
      passthrough: parsed.passthrough,
    },
    workspaceRoot,
    help: parsed.options.help === true,
  };
}

function readWorkspaceRoot(value: CliOptionValue | undefined): string {
  if (value === undefined) return process.cwd();
  if (typeof value !== "string" || value.length === 0) {
    throw new BitLiteError("--workspace requires a path");
  }
  return path.resolve(value);
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

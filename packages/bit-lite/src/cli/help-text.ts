import {
  commandDeclarations,
  effectiveCommandOptions,
  globalCommandOptions,
} from "./declarations.js";
import type { CommandDeclaration, CommandOption } from "./declarations.js";

/**
 * Help is a function from declarations to text. It reads no workspace, opens no
 * store, and starts no vendor, so it can be rendered anywhere and asserted on
 * directly.
 */

const INDENT = "  ";
const GAP = "  ";

export function renderCommandList(
  declarations: readonly CommandDeclaration[] = commandDeclarations
): string {
  const rows = declarations.map((declaration) => [declaration.name, declaration.summary] as const);
  return [
    "bit-lite",
    "",
    "Usage:",
    `${INDENT}bit-lite <command> [component-pattern...] [options]`,
    `${INDENT}bit-lite help <command>`,
    "",
    "Commands:",
    ...alignedRows(rows),
    "",
    "Options:",
    ...alignedRows(optionRows(globalCommandOptions)),
    "",
    `Run "bit-lite help <command>" for a command's own options and examples.`,
    "",
  ].join("\n");
}

export function renderCommandHelp(declaration: CommandDeclaration): string {
  const lines = [`Usage:`, `${INDENT}${renderSynopsis(declaration)}`, ""];

  lines.push(...wrap(declaration.description, 88).map((line) => `${INDENT}${line}`), "");

  const own = Object.keys(declaration.options);
  const effective = effectiveCommandOptions(declaration);
  const ordered = [...own, ...Object.keys(effective).filter((name) => !own.includes(name))];
  const rows = ordered.map((name) => {
    const option = effective[name]!;
    return [renderOptionSpelling(name, option), option.describe] as const;
  });
  lines.push("Options:", ...alignedRows(rows));

  if (declaration.selection === "components") {
    lines.push(
      "",
      `${INDENT}A component pattern may be written positionally instead of with --filter;`,
      `${INDENT}the two are equivalent and combine. Quote patterns containing * so the`,
      `${INDENT}shell does not expand them first.`
    );
  }

  if (declaration.unknownOptions === "forward") {
    lines.push(
      "",
      `${INDENT}Options this CLI does not define are passed to the vendor. Put vendor`,
      `${INDENT}arguments after -- when they would collide with an option listed above.`
    );
  }

  if (declaration.examples.length > 0) {
    lines.push("", "Examples:", ...declaration.examples.map((example) => `${INDENT}${example}`));
  }

  lines.push("");
  return lines.join("\n");
}

export function renderSynopsis(declaration: CommandDeclaration): string {
  const parts = ["bit-lite", declaration.name];
  if (declaration.selection === "components") parts.push("[component-pattern...]");
  if (declaration.selection === "command") parts.push("[command]");
  parts.push("[options]");
  if (declaration.unknownOptions === "forward") parts.push("[-- ...vendor-options]");
  return parts.join(" ");
}

/** `--dry-run`, `--workspace, -w <dir>` — the spelling as a user would type it. */
export function renderOptionSpelling(name: string, option: CommandOption): string {
  const spellings = [`--${name}`, ...(option.alias ?? []).map((alias) => `-${alias}`)];
  const joined = spellings.join(", ");
  return option.placeholder ? `${joined} ${option.placeholder}` : joined;
}

function optionRows(
  options: Readonly<Record<string, CommandOption>>
): (readonly [string, string])[] {
  return Object.entries(options).map(
    ([name, option]) => [renderOptionSpelling(name, option), option.describe] as const
  );
}

function alignedRows(rows: readonly (readonly [string, string])[]): string[] {
  const width = rows.reduce((longest, [left]) => Math.max(longest, left.length), 0);
  return rows.map(([left, right]) => `${INDENT}${left.padEnd(width)}${GAP}${right}`.trimEnd());
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current.length === 0) current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

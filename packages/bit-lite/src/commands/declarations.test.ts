import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { commandHandlers } from "../cli.js";
import {
  commandDeclarations,
  effectiveCommandOptions,
  findCommandDeclaration,
  globalCommandOptions,
} from "./declarations.js";

const commandsDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The table is only a single source of truth while it stays complete. These
 * assertions are what keeps it that way: a command added without a summary, or
 * an option read without being declared, fails here rather than in review.
 */
describe("command declarations", () => {
  it("gives every command a summary and a description", () => {
    for (const declaration of commandDeclarations) {
      expect(declaration.summary.length, `${declaration.name} summary`).toBeGreaterThan(0);
      expect(declaration.description.length, `${declaration.name} description`).toBeGreaterThan(0);
      expect(declaration.summary, `${declaration.name} summary`).not.toContain("\n");
    }
  });

  it("describes every declared option", () => {
    for (const declaration of commandDeclarations) {
      for (const [name, option] of Object.entries(declaration.options)) {
        expect(option.describe.length, `${declaration.name} --${name}`).toBeGreaterThan(0);
        // A placeholder is what a value looks like; a flag has no value to show.
        if (option.kind === "flag") {
          expect(option.placeholder, `${declaration.name} --${name}`).toBeUndefined();
        } else {
          expect(option.placeholder, `${declaration.name} --${name}`).toBeDefined();
        }
      }
    }
  });

  it("declares nothing globally that some command does not accept", () => {
    // The global set is exactly the options every command takes. Anything a
    // subset of commands reads belongs to those commands — that is what went
    // wrong with --lazy, which was global while only two commands read it.
    expect(Object.keys(globalCommandOptions).sort()).toEqual(["filter", "help", "workspace"]);
    for (const declaration of commandDeclarations) {
      for (const name of Object.keys(declaration.options)) {
        expect(globalCommandOptions[name], `${declaration.name} --${name}`).toBeUndefined();
      }
    }
  });

  it("declares --lazy on preview and start alone", () => {
    const withLazy = commandDeclarations
      .filter((declaration) => declaration.options.lazy !== undefined)
      .map((declaration) => declaration.name);

    expect(withLazy).toEqual(["preview", "start"]);
    expect(globalCommandOptions.lazy).toBeUndefined();
  });

  it("has a handler for every command except help, and no handler without one", () => {
    // `help` is answered before dispatch, so it is the one declared command
    // with no runner: asking about a command must never run it.
    const declared = commandDeclarations.map((declaration) => declaration.name);
    const runnable = declared.filter((name) => name !== "help");

    expect(Object.keys(commandHandlers).sort()).toEqual([...runnable].sort());
  });

  it("declares every option its command actually reads", () => {
    for (const declaration of commandDeclarations) {
      if (declaration.name === "help") continue;
      const source = readCommandSource(declaration.name);
      const options = effectiveCommandOptions(declaration);
      for (const name of readOptionNames(source)) {
        expect(options[name], `${declaration.name} reads --${name} without declaring it`)
          .toBeDefined();
      }
    }
  });

  it("resolves a declaration by name and nothing else", () => {
    expect(findCommandDeclaration("tag")?.name).toBe("tag");
    expect(findCommandDeclaration("nope")).toBeUndefined();
  });
});

function readCommandSource(name: string): string {
  // `watch` delegates to compile, so its option surface is compile's file.
  const file = name === "watch" ? "watch.ts" : `${name}.ts`;
  return readFileSync(path.join(commandsDir, file), "utf8");
}

/** `parsed.args.options.json` and `parsed.args.options["dry-run"]` alike. */
function readOptionNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/args\.options\.([A-Za-z][\w-]*)/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  for (const match of source.matchAll(/args\.options\[\s*"([^"]+)"\s*\]/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return [...names];
}

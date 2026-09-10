import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What: asserts that this package's directories are layers and that imports
 * only ever point downwards through them.
 *
 * Why: these four names replaced a single `utils/` directory that had
 * collected an execution engine, a watch session's shutdown, CLI option
 * readers, and the workspace preparation two commands compose — four tiers of
 * the program in one drawer, ordered by nothing. Naming them only helps while
 * the order holds, and it had already been broken once: `prepare-workspace.ts`
 * imported `commands/link.ts` and `commands/compile.ts`, which with
 * `compile.ts` importing back through `command-selection.ts` closed a cycle
 * through three modules.
 *
 * `package-boundaries.test.ts` makes the same kind of claim between packages.
 * This is its counterpart inside one.
 *
 * Tests are exempt. A test may drive the whole CLI from anywhere in the tree,
 * and doing so says nothing about what ships.
 */

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Lowest first. Each layer may import the ones before it and nothing after:
 *
 * - `cli` reads a command line and explains it back. It knows what can be
 *   typed and nothing about workspaces, envs, or vendors.
 * - `session` owns resources a resident command holds and releases.
 * - `execution` plans vendor work and runs or watches it.
 * - `commands` composes all of the above, and composes other commands.
 *
 * The files directly in `src/` — `bin.ts`, `cli.ts`, `index.ts` — sit above
 * every layer and may reach any of them.
 */
const layers = ["cli", "session", "execution", "commands"] as const;

/**
 * What the command-line layer is allowed to know. `bit-lite-utils` carries the
 * error type and the generic readers; anything else would mean parsing a
 * command line required knowing what a workspace is.
 */
const cliLayerPackages = new Set(["bit-lite-utils"]);

type SourceFile = {
  layer: string;
  relativePath: string;
  specifiers: string[];
};

/** Every module specifier a file imports, re-exports, or dynamically loads. */
function readSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]!);
  return specifiers;
}

async function readLayerSources(): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for (const layer of layers) {
    const directory = path.join(sourceDir, layer);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      if (entry.name.includes(".test.")) continue;
      files.push({
        layer,
        relativePath: `${layer}/${entry.name}`,
        specifiers: readSpecifiers(await readFile(path.join(directory, entry.name), "utf8")),
      });
    }
  }
  return files;
}

const sources = await readLayerSources();

describe("module layers", () => {
  it("finds the layers it describes", async () => {
    const directories = (await readdir(sourceDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name !== "assets")
      .map((entry) => entry.name)
      .sort();

    // `utils` is absent by design, not by accident: a module with no layer to
    // belong to is a layer that has not been named yet.
    expect(directories).toEqual([...layers].sort());
  });

  it.each(sources.map((file) => [file.relativePath, file] as const))(
    "%s imports only downwards",
    (_relativePath, file) => {
      const ownIndex = layers.indexOf(file.layer as (typeof layers)[number]);
      const upward = file.specifiers
        .filter((specifier) => specifier.startsWith("../"))
        .map((specifier) => specifier.slice(3).split("/")[0]!.replace(/\.js$/, ""))
        .filter((target) => {
          const targetIndex = layers.indexOf(target as (typeof layers)[number]);
          // A specifier naming no layer reaches a file directly in `src/`,
          // which is above every layer and never a legal target either.
          return targetIndex === -1 || targetIndex >= ownIndex;
        });

      expect(upward).toEqual([]);
    }
  );

  it.each(sources.filter((file) => file.layer === "cli").map((file) => [file.relativePath, file] as const))(
    "%s reaches no workspace package beyond the shared utilities",
    (_relativePath, file) => {
      const reached = file.specifiers.filter(
        (specifier) =>
          specifier.startsWith("bit-lite-") &&
          !cliLayerPackages.has(specifier.split("/")[0]!)
      );

      expect(reached).toEqual([]);
    }
  );
});

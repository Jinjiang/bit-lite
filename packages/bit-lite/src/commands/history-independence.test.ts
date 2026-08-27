import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { componentStoreDirectoryName } from "bit-lite-history";
import { describe, expect, it } from "vitest";

/**
 * What: proves the existing command surface stayed independent of Git and of
 * the component history store.
 *
 * Why: `snap`, `tag`, and `sync` introduce a hard Git dependency. Everything
 * else — install, link, compile, test, preview, start, watch — must keep
 * working on a machine without Git, and must never create or open
 * `.bit-lite-store.git`. Reading the sources is a cheap, total check: a future
 * import of the history package into a non-versioning command fails here.
 */

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));

/** Commands that predate component versioning. */
const nonVersioningCommands = [
  "compile.ts",
  "install.ts",
  "install-reporter.ts",
  "link.ts",
  "preview.ts",
  "start.ts",
  "start-source.ts",
  "test.ts",
  "test-routes.ts",
  "watch.ts",
];

const versioningCommands = ["snap.ts", "tag.ts", "sync.ts"];

async function readCommandSource(fileName: string): Promise<string> {
  return readFile(path.join(sourceDirectory, fileName), "utf8");
}

describe("existing commands stay independent of component history", () => {
  it.each(nonVersioningCommands)("%s does not import the history package", async (fileName) => {
    const source = await readCommandSource(fileName);
    expect(source).not.toContain("bit-lite-history");
  });

  it.each(nonVersioningCommands)("%s does not reference the durable store", async (fileName) => {
    const source = await readCommandSource(fileName);
    expect(source).not.toContain(componentStoreDirectoryName);
  });

  it.each(nonVersioningCommands)("%s does not invoke git", async (fileName) => {
    const source = await readCommandSource(fileName);
    // Catches `spawn("git"`, `"git"`, and `execFile("git", …)` alike.
    expect(source).not.toMatch(/["'`]git["'`]/);
  });

  it("keeps the git dependency confined to the versioning commands", async () => {
    for (const fileName of versioningCommands) {
      const source = await readCommandSource(fileName);
      expect(source).toContain("bit-lite-history");
    }
  });

  it("routes every command through the CLI without loading the history package", async () => {
    const cli = await readFile(path.join(sourceDirectory, "..", "cli.ts"), "utf8");

    // The CLI itself only wires command modules together; the history package
    // is reached through snap/tag/sync, never directly.
    expect(cli).not.toContain("bit-lite-history");
    for (const command of ["snap", "tag", "sync"]) {
      expect(cli).toContain(`./commands/${command}.js`);
    }
  });
});

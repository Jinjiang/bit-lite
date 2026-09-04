import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { componentStoreDirectoryName } from "bit-lite-history";
import { describe, expect, it } from "vitest";

/**
 * What: proves the existing command surface stayed independent of Git and of
 * the component history store.
 *
 * Why: the versioning and inspection commands introduce a hard Git
 * dependency. Everything else — install, link, compile, test, preview, start,
 * watch — must keep working on a machine without Git, and must never create or
 * open `.bit-lite-store.git`. Reading the sources is a cheap, total check: a
 * future import of the history package into a non-versioning command fails
 * here.
 *
 * The inspection commands add the mirror-image obligation. They may open the
 * store but must never create one, and must read the workspace the way `snap`
 * does, so asking what state a component is in never depends on an install.
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

/** Read-only commands over the same store. */
const inspectionCommands = ["status.ts", "log.ts", "diff.ts"];

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
    // is reached through the store-backed commands, never directly.
    expect(cli).not.toContain("bit-lite-history");
    for (const command of [...versioningCommands, ...inspectionCommands]) {
      expect(cli).toContain(`./commands/${command.replace(/\.ts$/, ".js")}`);
    }
  });
});

describe("inspection commands read the store without creating it", () => {
  it.each(inspectionCommands)("%s opens the store with create disabled", async (fileName) => {
    const source = await readCommandSource(fileName);

    expect(source).toContain("openComponentHistoryStore");
    // Opening without `create: false` would initialize a bare repository as a
    // side effect of asking a read-only question.
    expect(source).toContain("create: false");
  });

  it.each(inspectionCommands)("%s answers before opening a store at all", async (fileName) => {
    const source = await readCommandSource(fileName);

    // A workspace with no store is answered from the absent directory, so
    // inspection needs neither a store nor Git to say "never recorded".
    expect(source).toContain("resolveComponentStorePath");
  });

  it.each(inspectionCommands)("%s never writes objects, refs, or anchors", async (fileName) => {
    const source = await readCommandSource(fileName);

    for (const writingEntryPoint of [
      "prepareComponentSnap",
      "publishComponentSnaps",
      "snapComponents",
      "tagComponent",
      "writeSnapshotTree",
      "writeSnapshotBlobs",
      "writeRecordedVersions",
      "updateRefsAtomically",
    ]) {
      expect(source).not.toContain(writingEntryPoint);
    }
  });

  it.each(inspectionCommands)("%s reads the workspace without resolving envs", async (fileName) => {
    const source = await readCommandSource(fileName);

    // `readWorkspace` is the install-independent path `snap` uses;
    // `prepareResolvedCommandSelection` loads env packages and would make
    // inspection depend on a completed install.
    expect(source).toContain("readWorkspace");
    expect(source).not.toContain("prepareResolvedCommandSelection");
    expect(source).not.toContain("prepareWorkspaceForEnvLoading");
  });
});

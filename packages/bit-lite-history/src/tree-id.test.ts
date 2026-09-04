import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGitLine } from "./git-process.js";
import { computeSnapshotTree, writeSnapshotTree } from "./objects.js";
import { readComponentSnapshot } from "./snapshot.js";
import { openComponentHistoryStore, type ComponentHistoryStore } from "./store.js";

/**
 * This file is the only thing tying the hand-written tree serializer to Git's
 * own. A failure here means inspection and recording disagree about whether a
 * component changed, which is exactly what the compute-only path exists to
 * prevent — so these assertions are load-bearing, not illustrative.
 */

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function createWorkspace(): Promise<{
  workspaceRoot: string;
  store: ComponentHistoryStore;
}> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-history-tree-"));
  temporaryRoots.push(workspaceRoot);
  const store = await openComponentHistoryStore({ workspaceRoot });
  return { workspaceRoot, store };
}

async function writeComponentFile(
  rootDir: string,
  relativePath: string,
  contents: string
): Promise<string> {
  const absolutePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
  return absolutePath;
}

/**
 * Deliberately awkward: nested directories, a directory whose name is a prefix
 * of a sibling file's, and names that sort differently under Git's
 * trailing-slash rule than as plain strings.
 */
async function createComponent(workspaceRoot: string): Promise<string> {
  const rootDir = path.join(workspaceRoot, "ui-button");
  await mkdir(rootDir, { recursive: true });
  await writeComponentFile(rootDir, ".comp.json", `{"id":"ui/button"}\n`);
  await writeComponentFile(rootDir, "README.md", "# button\n");
  await writeComponentFile(rootDir, "src/index.ts", "export const id = 'ui/button';\n");
  await writeComponentFile(rootDir, "src/nested/deep/value.ts", "export const deep = 1;\n");
  // "src.config.ts" sorts before "src/" only once the directory is compared
  // with its trailing slash; as plain names "src" sorts first.
  await writeComponentFile(rootDir, "src.config.ts", "export const config = {};\n");
  await writeComponentFile(rootDir, "src-extra.ts", "export const extra = 2;\n");
  return rootDir;
}

async function countObjects(store: ComponentHistoryStore): Promise<number> {
  const output = await runGitLine(store.run, ["count-objects", "-v"]);
  const line = output.split("\n").find((entry) => entry.startsWith("count "));
  return Number(line?.slice("count ".length) ?? "0");
}

async function listRefs(store: ComponentHistoryStore): Promise<string> {
  const result = await store.run({ args: ["for-each-ref", "--format=%(refname) %(objectname)"] });
  return result.stdout.toString("utf8");
}

describe("compute-only tree identity", () => {
  it("matches the writing path on a component with nested directories", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const rootDir = await createComponent(workspaceRoot);
    const snapshot = await readComponentSnapshot({ componentId: "ui/button", rootDir });

    const computed = await computeSnapshotTree(store, snapshot);
    const written = await writeSnapshotTree(store, snapshot);

    expect(computed).toEqual(written);
  });

  it("matches the writing path on executable modes", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const rootDir = await createComponent(workspaceRoot);
    const scriptPath = await writeComponentFile(rootDir, "scripts/build.sh", "#!/bin/sh\n");
    await chmod(scriptPath, 0o755);
    const snapshot = await readComponentSnapshot({ componentId: "ui/button", rootDir });

    expect(snapshot.files.some((file) => file.mode === "100755")).toBe(true);
    expect(await computeSnapshotTree(store, snapshot)).toEqual(
      await writeSnapshotTree(store, snapshot)
    );
  });

  it("matches the writing path on substituted metadata", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const rootDir = await createComponent(workspaceRoot);
    const snapshot = await readComponentSnapshot({
      componentId: "ui/button",
      rootDir,
      contentOverrides: new Map([
        [".comp.json", Buffer.from(`{"env":{"packageName":"env.react"}}\n`, "utf8")],
      ]),
    });

    expect(await computeSnapshotTree(store, snapshot)).toEqual(
      await writeSnapshotTree(store, snapshot)
    );
  });

  it("matches the writing path on a component with one root-level file", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const rootDir = path.join(workspaceRoot, "lib-math");
    await mkdir(rootDir, { recursive: true });
    await writeComponentFile(rootDir, ".comp.json", `{"id":"lib/math"}\n`);
    const snapshot = await readComponentSnapshot({ componentId: "lib/math", rootDir });

    expect(await computeSnapshotTree(store, snapshot)).toEqual(
      await writeSnapshotTree(store, snapshot)
    );
  });
});

describe("compute-only runs leave the store alone", () => {
  it("adds no objects and changes no refs", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const rootDir = await createComponent(workspaceRoot);
    const snapshot = await readComponentSnapshot({ componentId: "ui/button", rootDir });

    const objectsBefore = await countObjects(store);
    const refsBefore = await listRefs(store);

    await computeSnapshotTree(store, snapshot);
    await computeSnapshotTree(store, snapshot);

    expect(await countObjects(store)).toBe(objectsBefore);
    expect(await listRefs(store)).toBe(refsBefore);
  });
});

import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readComponentCommit, readComponentHead } from "./commits.js";
import { runGitLine, type GitCommandInput } from "./git-process.js";
import { parseObjectId } from "./object-id.js";
import { componentHeadRef } from "./refs.js";
import { snapComponents, type SnapRequest } from "./snap.js";
import { openComponentHistoryStore, type ComponentHistoryStore } from "./store.js";

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
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-history-snap-"));
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

async function createComponent(
  workspaceRoot: string,
  componentId: string,
  directoryName: string
): Promise<SnapRequest> {
  const rootDir = path.join(workspaceRoot, directoryName);
  await mkdir(rootDir, { recursive: true });
  await writeComponentFile(rootDir, ".comp.json", `{"id":"${componentId}"}`);
  await writeComponentFile(rootDir, "src/index.ts", `export const id = "${componentId}";`);
  return { componentId, rootDir };
}

/** Lists a commit's tree as `<mode> <type> <oid>\t<path>` records. */
async function listTree(store: ComponentHistoryStore, commitHex: string): Promise<string[]> {
  const output = await runGitLine(store.run, ["ls-tree", "-r", commitHex]);
  return output.length === 0 ? [] : output.split("\n");
}

async function readBlob(
  store: ComponentHistoryStore,
  commitHex: string,
  filePath: string
): Promise<string> {
  const result = await store.run({ args: ["cat-file", "blob", `${commitHex}:${filePath}`] });
  return result.stdout.toString("utf8");
}

describe("snap object preparation", () => {
  it("captures every component file category with exact bytes", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    await writeComponentFile(component.rootDir, "docs/usage.md", "# Usage\n");
    await writeComponentFile(component.rootDir, "demos/basic.tsx", "export default null;\n");
    await writeComponentFile(component.rootDir, "tests/button.test.ts", "test\n");
    await writeComponentFile(component.rootDir, "assets/icon.svg", "<svg/>\n");
    await writeComponentFile(component.rootDir, ".npmrc", "audit=false\n");

    const result = await snapComponents(store, [component]);
    const snapId = parseObjectId(result.components[0]!.snapId);

    const paths = (await listTree(store, snapId.hex)).map((line) => line.split("\t")[1]);
    expect(paths).toEqual([
      ".comp.json",
      ".npmrc",
      "assets/icon.svg",
      "demos/basic.tsx",
      "docs/usage.md",
      "src/index.ts",
      "tests/button.test.ts",
    ]);
    expect(await readBlob(store, snapId.hex, "docs/usage.md")).toBe("# Usage\n");
    expect(await readBlob(store, snapId.hex, ".comp.json")).toBe('{"id":"ui/button"}');
  });

  it("records executable mode in the tree", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    const scriptPath = await writeComponentFile(component.rootDir, "bin/run.sh", "#!/bin/sh\n");
    await chmod(scriptPath, 0o755);

    const result = await snapComponents(store, [component]);
    const snapId = parseObjectId(result.components[0]!.snapId);
    const entries = await listTree(store, snapId.hex);

    expect(entries.find((entry) => entry.endsWith("bin/run.sh"))).toMatch(/^100755 blob /);
    expect(entries.find((entry) => entry.endsWith("src/index.ts"))).toMatch(/^100644 blob /);
  });

  it("excludes pruned directories from the tree", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    await writeComponentFile(component.rootDir, "node_modules/pkg/index.js", "drop");
    await writeComponentFile(component.rootDir, "dist/index.js", "drop");
    await writeComponentFile(component.rootDir, "src/nested/coverage/report.html", "drop");

    const result = await snapComponents(store, [component]);
    const snapId = parseObjectId(result.components[0]!.snapId);
    const paths = (await listTree(store, snapId.hex)).map((line) => line.split("\t")[1]);

    expect(paths).toEqual([".comp.json", "src/index.ts"]);
  });

  it("reports algorithm-qualified snap and tree ids", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");

    const result = await snapComponents(store, [component]);
    const snap = result.components[0]!;

    expect(snap.snapId.startsWith(`${store.objectFormat}:`)).toBe(true);
    expect(snap.treeId.startsWith(`${store.objectFormat}:`)).toBe(true);
    expect(parseObjectId(snap.snapId).algorithm).toBe(store.objectFormat);
  });
});

describe("component history shape", () => {
  it("creates a root commit with no parent for a first snap", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");

    const result = await snapComponents(store, [component]);
    const snapId = parseObjectId(result.components[0]!.snapId);
    const commit = await readComponentCommit(store, snapId);

    expect(commit.parentIds).toEqual([]);
    expect(result.components[0]!.status).toBe("created");
  });

  it("parents each later snap on the component's previous snap", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");

    const first = await snapComponents(store, [component]);
    await writeComponentFile(component.rootDir, "src/index.ts", "export const id = 2;");
    const second = await snapComponents(store, [component]);

    const firstId = parseObjectId(first.components[0]!.snapId);
    const secondId = parseObjectId(second.components[0]!.snapId);
    const commit = await readComponentCommit(store, secondId);

    expect(commit.parentIds.map((parent) => parent.hex)).toEqual([firstId.hex]);
  });

  it("advances only the snapped component's ref", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const button = await createComponent(workspaceRoot, "ui/button", "button");
    const card = await createComponent(workspaceRoot, "ui/card", "card");

    await snapComponents(store, [button]);
    const cardHeadBefore = await readComponentHead(store, "ui/card");
    expect(cardHeadBefore).toBeUndefined();

    await snapComponents(store, [card]);
    const buttonHead = await readComponentHead(store, "ui/button");
    const cardHead = await readComponentHead(store, "ui/card");
    expect(buttonHead).toBeDefined();
    expect(cardHead).toBeDefined();
    expect(buttonHead?.hex).not.toBe(cardHead?.hex);
  });

  it("keeps independent components out of each other's history", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const button = await createComponent(workspaceRoot, "ui/button", "button");
    const card = await createComponent(workspaceRoot, "ui/card", "card");

    await snapComponents(store, [button]);
    await snapComponents(store, [card]);
    await writeComponentFile(button.rootDir, "src/index.ts", "changed");
    await snapComponents(store, [button]);

    const buttonHead = (await readComponentHead(store, "ui/button"))!;
    const cardHead = (await readComponentHead(store, "ui/card"))!;

    const buttonHistory = await runGitLine(store.run, [
      "rev-list",
      componentHeadRef("ui/button"),
    ]);
    expect(buttonHistory.split("\n")).toHaveLength(2);
    expect(buttonHistory).not.toContain(cardHead.hex);

    const cardHistory = await runGitLine(store.run, ["rev-list", componentHeadRef("ui/card")]);
    expect(cardHistory.split("\n")).toHaveLength(1);
    expect(cardHistory).not.toContain(buttonHead.hex);
  });
});

describe("content-aware publication", () => {
  it("creates no commit when the captured tree is unchanged", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");

    const first = await snapComponents(store, [component]);
    const headAfterFirst = (await readComponentHead(store, "ui/button"))!;
    const second = await snapComponents(store, [component]);
    const headAfterSecond = (await readComponentHead(store, "ui/button"))!;

    expect(second.components[0]!.status).toBe("unchanged");
    expect(second.unchanged).toHaveLength(1);
    expect(second.changed).toHaveLength(0);
    expect(headAfterSecond.hex).toBe(headAfterFirst.hex);
    expect(second.components[0]!.snapId).toBe(first.components[0]!.snapId);
  });

  it("treats a changed file as changed even when the file count matches", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    await snapComponents(store, [component]);

    await writeComponentFile(component.rootDir, "src/index.ts", "export const id = 3;");
    const second = await snapComponents(store, [component]);

    expect(second.components[0]!.status).toBe("created");
  });

  it("publishes several components as one transaction", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const button = await createComponent(workspaceRoot, "ui/button", "button");
    const card = await createComponent(workspaceRoot, "ui/card", "card");

    const result = await snapComponents(store, [button, card]);

    expect(result.changed).toHaveLength(2);
    expect(await readComponentHead(store, "ui/button")).toBeDefined();
    expect(await readComponentHead(store, "ui/card")).toBeDefined();
  });

  it("advances no ref when one selected component cannot be captured", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const button = await createComponent(workspaceRoot, "ui/button", "button");
    const card = await createComponent(workspaceRoot, "ui/card", "card");
    await symlink(path.join(card.rootDir, "src/index.ts"), path.join(card.rootDir, "alias.ts"));

    await expect(snapComponents(store, [button, card])).rejects.toThrow(/symbolic link/);

    expect(await readComponentHead(store, "ui/button")).toBeUndefined();
    expect(await readComponentHead(store, "ui/card")).toBeUndefined();
  });

  it("leaves an existing ref untouched when a later component fails", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const button = await createComponent(workspaceRoot, "ui/button", "button");
    const card = await createComponent(workspaceRoot, "ui/card", "card");
    await snapComponents(store, [button]);
    const buttonHeadBefore = (await readComponentHead(store, "ui/button"))!;

    await writeComponentFile(button.rootDir, "src/index.ts", "changed");
    await symlink(path.join(card.rootDir, "src/index.ts"), path.join(card.rootDir, "alias.ts"));
    await expect(snapComponents(store, [button, card])).rejects.toThrow(/symbolic link/);

    const buttonHeadAfter = (await readComponentHead(store, "ui/button"))!;
    expect(buttonHeadAfter.hex).toBe(buttonHeadBefore.hex);
  });

  it("fails instead of overwriting a ref that moved concurrently", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    await snapComponents(store, [component]);
    const original = (await readComponentHead(store, "ui/button"))!;

    // Produce a second snap, then rewind the ref so the next preparation reads
    // `original` again while `concurrent` stays a valid commit to race in.
    await writeComponentFile(component.rootDir, "src/index.ts", "concurrent");
    const concurrent = await snapComponents(store, [component]);
    const concurrentId = parseObjectId(concurrent.components[0]!.snapId);
    expect(concurrentId.hex).not.toBe(original.hex);
    await store.run({
      args: ["update-ref", componentHeadRef("ui/button"), original.hex, concurrentId.hex],
    });

    // Move the ref forward again between preparation and publication, which is
    // exactly the window the expected-old-value guard protects.
    let raced = false;
    const racingStore: ComponentHistoryStore = {
      ...store,
      run: async (input: GitCommandInput) => {
        const result = await store.run(input);
        if (!raced && input.args[0] === "commit-tree") {
          raced = true;
          await store.run({
            args: ["update-ref", componentHeadRef("ui/button"), concurrentId.hex, original.hex],
          });
        }
        return result;
      },
    };

    await writeComponentFile(component.rootDir, "src/index.ts", "third");
    await expect(snapComponents(racingStore, [component])).rejects.toThrow();
    expect(raced).toBe(true);

    // The concurrent snap survives; it was not overwritten.
    expect((await readComponentHead(store, "ui/button"))!.hex).toBe(concurrentId.hex);
  });

  it("rejects the same component twice in one snap", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");

    await expect(snapComponents(store, [component, component])).rejects.toThrow(
      /selected more than once/
    );
  });
});

describe("snapshot boundary", () => {
  it("reports a component as unchanged when only workspace state changes", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    await snapComponents(store, [component]);

    // Workspace-level configuration lives outside the component directory and
    // is not part of the v1 snapshot boundary.
    await writeComponentFile(workspaceRoot, "bit-lite.json", '{"components":[]}');
    const second = await snapComponents(store, [component]);

    expect(second.components[0]!.status).toBe("unchanged");
  });

  it("does not wrap the tree in a component directory", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");

    const result = await snapComponents(store, [component]);
    const snapId = parseObjectId(result.components[0]!.snapId);
    const paths = (await listTree(store, snapId.hex)).map((line) => line.split("\t")[1]);

    expect(paths.every((entry) => !entry?.startsWith("button/"))).toBe(true);
  });
});

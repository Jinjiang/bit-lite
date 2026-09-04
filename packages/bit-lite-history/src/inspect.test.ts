import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readComponentHead } from "./commits.js";
import {
  compareTrees,
  readComponentHistory,
  readTreeFile,
  readTreeFiles,
  readVersionsBySnap,
} from "./inspect.js";
import { readCommitTree } from "./objects.js";
import { snapComponents } from "./snap.js";
import { openComponentHistoryStore, type ComponentHistoryStore } from "./store.js";
import { tagComponent } from "./tags.js";

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
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-history-inspect-"));
  temporaryRoots.push(workspaceRoot);
  const store = await openComponentHistoryStore({ workspaceRoot });
  return { workspaceRoot, store };
}

async function writeComponentFile(
  rootDir: string,
  relativePath: string,
  contents: string
): Promise<void> {
  const absolutePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

async function createComponent(workspaceRoot: string, componentId: string, dir: string) {
  const rootDir = path.join(workspaceRoot, dir);
  await mkdir(rootDir, { recursive: true });
  await writeComponentFile(rootDir, ".comp.json", `{"id":"${componentId}"}\n`);
  await writeComponentFile(rootDir, "src/index.ts", `export const id = "${componentId}";\n`);
  return { componentId, rootDir };
}

async function headTree(store: ComponentHistoryStore, componentId: string) {
  const head = await readComponentHead(store, componentId);
  return head === undefined ? undefined : readCommitTree(store, head);
}

describe("component history walking", () => {
  it("lists snaps from the head backwards along parent links", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const request = await createComponent(workspaceRoot, "ui/button", "ui-button");

    await snapComponents(store, [request]);
    await writeComponentFile(request.rootDir, "src/index.ts", "export const id = 'v2';\n");
    await snapComponents(store, [request]);
    await writeComponentFile(request.rootDir, "src/index.ts", "export const id = 'v3';\n");
    const third = await snapComponents(store, [request]);

    const history = await readComponentHistory(store, "ui/button");

    expect(history).toHaveLength(3);
    expect(history[0]?.commit.id.hex).toBe(third.components[0]?.snapId.split(":").at(-1));
    expect(history[0]?.commit.parentIds[0]?.hex).toBe(history[1]?.commit.id.hex);
    expect(history.at(-1)?.commit.parentIds).toHaveLength(0);
  });

  it("carries an authored timestamp on every entry", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const request = await createComponent(workspaceRoot, "ui/button", "ui-button");
    await snapComponents(store, [request]);

    const [entry] = await readComponentHistory(store, "ui/button");

    expect(entry?.commit.authoredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isNaN(Date.parse(entry!.commit.authoredAt))).toBe(false);
  });

  it("lists no snap belonging to another component", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const button = await createComponent(workspaceRoot, "ui/button", "ui-button");
    const card = await createComponent(workspaceRoot, "ui/card", "ui-card");

    await snapComponents(store, [button, card]);
    await writeComponentFile(button.rootDir, "src/index.ts", "export const id = 'v2';\n");
    await snapComponents(store, [button]);

    expect(await readComponentHistory(store, "ui/button")).toHaveLength(2);
    expect(await readComponentHistory(store, "ui/card")).toHaveLength(1);
  });

  it("reports a component with no history as an empty walk rather than failing", async () => {
    const { store } = await createWorkspace();

    await expect(readComponentHistory(store, "ui/never-snapped")).resolves.toEqual([]);
  });

  it("honours a limit", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const request = await createComponent(workspaceRoot, "ui/button", "ui-button");
    await snapComponents(store, [request]);
    await writeComponentFile(request.rootDir, "src/index.ts", "export const id = 'v2';\n");
    await snapComponents(store, [request]);

    expect(await readComponentHistory(store, "ui/button", { limit: 1 })).toHaveLength(1);
  });
});

describe("tag decoration", () => {
  it("decorates a snap with every version assigned to it", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const request = await createComponent(workspaceRoot, "ui/button", "ui-button");
    await snapComponents(store, [request]);
    await tagComponent(store, { componentId: "ui/button", version: "0.0.1" });
    await tagComponent(store, { componentId: "ui/button", version: "0.1.0" });

    const [entry] = await readComponentHistory(store, "ui/button");

    expect(entry?.versions).toEqual(["0.0.1", "0.1.0"]);
  });

  it("leaves an untagged snap undecorated", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const request = await createComponent(workspaceRoot, "ui/button", "ui-button");
    await snapComponents(store, [request]);
    await tagComponent(store, { componentId: "ui/button", version: "0.0.1" });
    await writeComponentFile(request.rootDir, "src/index.ts", "export const id = 'v2';\n");
    await snapComponents(store, [request]);

    const history = await readComponentHistory(store, "ui/button");

    expect(history[0]?.versions).toEqual([]);
    expect(history[1]?.versions).toEqual(["0.0.1"]);
  });

  it("groups versions by the snap they name", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const request = await createComponent(workspaceRoot, "ui/button", "ui-button");
    await snapComponents(store, [request]);
    await tagComponent(store, { componentId: "ui/button", version: "0.0.1" });

    const head = await readComponentHead(store, "ui/button");
    const bySnap = await readVersionsBySnap(store, "ui/button");

    expect(bySnap.get(head!.hex)).toEqual(["0.0.1"]);
  });

  it("returns no versions for a component that was never tagged", async () => {
    const { store } = await createWorkspace();

    expect(await readVersionsBySnap(store, "ui/never-snapped")).toEqual(new Map());
  });
});

describe("tree reading and comparison", () => {
  it("lists a tree's files as component-relative paths", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const request = await createComponent(workspaceRoot, "ui/button", "ui-button");
    await snapComponents(store, [request]);

    const files = await readTreeFiles(store, (await headTree(store, "ui/button"))!);

    expect(files.map((file) => file.path).sort()).toEqual([".comp.json", "src/index.ts"]);
  });

  it("reports added, modified, and deleted paths", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const request = await createComponent(workspaceRoot, "ui/button", "ui-button");
    await snapComponents(store, [request]);
    const before = (await headTree(store, "ui/button"))!;

    await writeComponentFile(request.rootDir, "src/index.ts", "export const id = 'changed';\n");
    await writeComponentFile(request.rootDir, "src/extra.ts", "export const extra = 1;\n");
    await rm(path.join(request.rootDir, ".comp.json"));
    await snapComponents(store, [request]);
    const after = (await headTree(store, "ui/button"))!;

    expect(await compareTrees(store, before, after)).toEqual([
      { path: ".comp.json", status: "deleted" },
      { path: "src/extra.ts", status: "added" },
      { path: "src/index.ts", status: "modified" },
    ]);
  });

  it("reports no changes between identical trees", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const request = await createComponent(workspaceRoot, "ui/button", "ui-button");
    await snapComponents(store, [request]);
    const tree = (await headTree(store, "ui/button"))!;

    expect(await compareTrees(store, tree, tree)).toEqual([]);
  });

  it("treats an absent side as everything added or deleted", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const request = await createComponent(workspaceRoot, "ui/button", "ui-button");
    await snapComponents(store, [request]);
    const tree = (await headTree(store, "ui/button"))!;

    expect(await compareTrees(store, undefined, tree)).toEqual([
      { path: ".comp.json", status: "added" },
      { path: "src/index.ts", status: "added" },
    ]);
    expect(await compareTrees(store, tree, undefined)).toEqual([
      { path: ".comp.json", status: "deleted" },
      { path: "src/index.ts", status: "deleted" },
    ]);
  });
});

describe("recorded metadata reading", () => {
  it("reads a file's bytes out of a snap's tree", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const request = await createComponent(workspaceRoot, "ui/button", "ui-button");
    await snapComponents(store, [request]);

    const bytes = await readTreeFile(store, (await headTree(store, "ui/button"))!, ".comp.json");

    expect(JSON.parse(bytes!.toString("utf8"))).toEqual({ id: "ui/button" });
  });

  it("returns undefined for a path the tree does not contain", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const request = await createComponent(workspaceRoot, "ui/button", "ui-button");
    await snapComponents(store, [request]);

    const bytes = await readTreeFile(store, (await headTree(store, "ui/button"))!, "absent.json");

    expect(bytes).toBeUndefined();
  });
});

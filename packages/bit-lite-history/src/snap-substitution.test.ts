import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readComponentHead } from "./commits.js";
import { runGitLine } from "./git-process.js";
import { parseObjectId } from "./object-id.js";
import {
  prepareComponentSnap,
  publishComponentSnaps,
  snapComponents,
  type SnapRequest,
} from "./snap.js";
import { readComponentSnapshot } from "./snapshot.js";
import { openComponentHistoryStore, type ComponentHistoryStore } from "./store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("snapshot content substitution", () => {
  it("records substituted bytes while capturing every other file verbatim", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");

    const result = await snapComponents(store, [
      { ...component, contentOverrides: overrides({ ".comp.json": '{"projected":true}' }) },
    ]);

    const snapHex = parseObjectId(result.components[0]!.snapId).hex;
    expect(await readBlob(store, snapHex, ".comp.json")).toBe('{"projected":true}');
    expect(await readBlob(store, snapHex, "src/index.ts")).toBe('export const id = "ui/button";');
    // The working file keeps the bytes the caller never asked to change.
    expect(await readFile(path.join(component.rootDir, ".comp.json"), "utf8")).toBe(
      '{"id":"ui/button"}'
    );
  });

  it("keeps the substituted file at its own path and mode", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");

    const result = await snapComponents(store, [
      { ...component, contentOverrides: overrides({ ".comp.json": "{}" }) },
    ]);

    const entries = await listTree(store, parseObjectId(result.components[0]!.snapId).hex);
    expect(entries.map((entry) => entry.split("\t")[1])).toEqual([".comp.json", "src/index.ts"]);
    expect(entries[0]).toMatch(/^100644 blob /);
  });

  it("makes the recorded tree depend on the substituted bytes, not the file on disk", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");

    const first = await snapComponents(store, [
      { ...component, contentOverrides: overrides({ ".comp.json": '{"dep":"1"}' }) },
    ]);
    const unchanged = await snapComponents(store, [
      { ...component, contentOverrides: overrides({ ".comp.json": '{"dep":"1"}' }) },
    ]);
    const changed = await snapComponents(store, [
      { ...component, contentOverrides: overrides({ ".comp.json": '{"dep":"2"}' }) },
    ]);

    expect(unchanged.components[0]!.status).toBe("unchanged");
    expect(unchanged.components[0]!.treeId).toBe(first.components[0]!.treeId);
    expect(changed.components[0]!.status).toBe("created");
    expect(changed.components[0]!.treeId).not.toBe(first.components[0]!.treeId);
  });

  it("refuses to substitute a path the component does not contain", async () => {
    const { workspaceRoot } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");

    await expect(
      readComponentSnapshot({
        ...component,
        contentOverrides: overrides({ "src/missing.ts": "export {};" }),
      })
    ).rejects.toThrow('component "ui/button" has no file at src/missing.ts to substitute');
  });

  it("substitutes bytes that are not valid UTF-8 text", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    const bytes = Uint8Array.from([0x00, 0xff, 0xfe, 0x10]);

    const result = await snapComponents(store, [
      { ...component, contentOverrides: new Map([[".comp.json", bytes]]) },
    ]);

    const snapHex = parseObjectId(result.components[0]!.snapId).hex;
    const stored = await store.run({ args: ["cat-file", "blob", `${snapHex}:.comp.json`] });
    expect([...stored.stdout]).toEqual([...bytes]);
  });
});

describe("prepare and publish phases", () => {
  it("writes objects during preparation without moving any ref", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");

    const prepared = await prepareComponentSnap(store, component);

    expect(prepared.commitId).toBeDefined();
    expect(prepared.snapId).toEqual(prepared.commitId);
    expect(await readComponentHead(store, "ui/button")).toBeUndefined();
    // The commit object exists even though nothing references it yet.
    expect(await runGitLine(store.run, ["cat-file", "-t", prepared.snapId.hex])).toBe("commit");
  });

  it("moves refs only once publication runs", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const button = await createComponent(workspaceRoot, "ui/button", "button");
    const math = await createComponent(workspaceRoot, "lib/math", "math");

    const prepared = [
      await prepareComponentSnap(store, button),
      await prepareComponentSnap(store, math),
    ];
    expect(await readComponentHead(store, "ui/button")).toBeUndefined();

    const result = await publishComponentSnaps(store, prepared);

    expect(result.changed.map((item) => item.componentId)).toEqual(["ui/button", "lib/math"]);
    expect((await readComponentHead(store, "ui/button"))?.hex).toBe(prepared[0]!.snapId.hex);
    expect((await readComponentHead(store, "lib/math"))?.hex).toBe(prepared[1]!.snapId.hex);
  });

  it("reports a component whose tree matched its head as unchanged", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    const first = await snapComponents(store, [component]);

    const prepared = await prepareComponentSnap(store, component);

    expect(prepared.commitId).toBeUndefined();
    expect(prepared.snapId.hex).toBe(parseObjectId(first.components[0]!.snapId).hex);

    const result = await publishComponentSnaps(store, [prepared]);
    expect(result.unchanged.map((item) => item.componentId)).toEqual(["ui/button"]);
  });

  it("rejects publishing the same component twice in one operation", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    const prepared = await prepareComponentSnap(store, component);

    await expect(publishComponentSnaps(store, [prepared, prepared])).rejects.toThrow(
      'component "ui/button" was selected more than once'
    );
  });
});

function overrides(entries: Record<string, string>): ReadonlyMap<string, Uint8Array> {
  return new Map(
    Object.entries(entries).map(([filePath, content]) => [filePath, Buffer.from(content, "utf8")])
  );
}

async function createWorkspace(): Promise<{
  workspaceRoot: string;
  store: ComponentHistoryStore;
}> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-history-substitute-"));
  temporaryRoots.push(workspaceRoot);
  return { workspaceRoot, store: await openComponentHistoryStore({ workspaceRoot }) };
}

async function createComponent(
  workspaceRoot: string,
  componentId: string,
  directoryName: string
): Promise<SnapRequest> {
  const rootDir = path.join(workspaceRoot, directoryName);
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(path.join(rootDir, ".comp.json"), `{"id":"${componentId}"}`);
  await writeFile(path.join(rootDir, "src/index.ts"), `export const id = "${componentId}";`);
  return { componentId, rootDir };
}

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

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ComponentHistoryError } from "./errors.js";
import { runGitLine } from "./git-process.js";
import { parseObjectId } from "./object-id.js";
import { componentTagRef } from "./refs.js";
import { snapComponents, type SnapRequest } from "./snap.js";
import { openComponentHistoryStore, type ComponentHistoryStore } from "./store.js";
import { assertComponentVersion, assertValidComponentTag, tagComponent } from "./tags.js";

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
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-history-tag-"));
  temporaryRoots.push(workspaceRoot);
  const store = await openComponentHistoryStore({ workspaceRoot });
  return { workspaceRoot, store };
}

async function createComponent(
  workspaceRoot: string,
  componentId: string,
  directoryName: string,
  contents = "initial"
): Promise<SnapRequest> {
  const rootDir = path.join(workspaceRoot, directoryName);
  await mkdir(rootDir, { recursive: true });
  await writeFile(path.join(rootDir, "index.ts"), `export const id = "${contents}";\n`);
  return { componentId, rootDir };
}

describe("component version validation", () => {
  it("accepts exact semantic versions", () => {
    for (const version of ["0.0.0", "1.2.3", "1.2.3-rc.1", "1.2.3+build.5"]) {
      expect(assertComponentVersion(version)).toBe(version);
    }
  });

  it("rejects ranges, prefixes, and loose spellings", () => {
    for (const version of ["1.2", "v1.2.3", "^1.2.3", "~1.2.3", "1.2.3.4", "latest", ""]) {
      expect(() => assertComponentVersion(version)).toThrow(ComponentHistoryError);
    }
  });
});

describe("component tags", () => {
  it("creates an annotated tag at the component's current snap", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    const snap = await snapComponents(store, [component]);

    const tag = await tagComponent(store, { componentId: "ui/button", version: "1.0.0" });

    expect(tag.status).toBe("created");
    expect(tag.snapId).toBe(snap.components[0]!.snapId);
    expect(tag.ref).toBe(componentTagRef("ui/button", "1.0.0"));
    // Annotated tags are real objects; a lightweight tag would report "commit".
    expect(await runGitLine(store.run, ["cat-file", "-t", tag.ref])).toBe("tag");
  });

  it("refuses to tag a component that has no snap", async () => {
    const { store } = await createWorkspace();
    await expect(
      tagComponent(store, { componentId: "ui/button", version: "1.0.0" })
    ).rejects.toThrow(/has no snap to tag/);
  });

  it("never creates a snap as a side effect", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    await snapComponents(store, [component]);
    const before = await runGitLine(store.run, ["rev-list", "--count", "--all"]);

    await writeFile(path.join(component.rootDir, "index.ts"), "export const id = 'changed';\n");
    await tagComponent(store, { componentId: "ui/button", version: "1.0.0" });

    expect(await runGitLine(store.run, ["rev-list", "--count", "--all"])).toBe(before);
  });

  it("rejects an invalid version before touching the store", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    await snapComponents(store, [component]);

    await expect(
      tagComponent(store, { componentId: "ui/button", version: "1.2" })
    ).rejects.toThrow(/strict semantic version/);
    expect(await runGitLine(store.run, ["for-each-ref", "refs/tags"])).toBe("");
  });

  it("is idempotent when the same version is reapplied to the same snap", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    await snapComponents(store, [component]);

    const first = await tagComponent(store, { componentId: "ui/button", version: "1.0.0" });
    const firstObject = await runGitLine(store.run, ["rev-parse", first.ref]);

    const second = await tagComponent(store, { componentId: "ui/button", version: "1.0.0" });

    expect(second.status).toBe("unchanged");
    expect(second.snapId).toBe(first.snapId);
    // The original tag object survives, so its tagger and timestamp stay true.
    expect(await runGitLine(store.run, ["rev-parse", second.ref])).toBe(firstObject);
  });

  it("refuses to move a version to a different snap", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    await snapComponents(store, [component]);
    const tag = await tagComponent(store, { componentId: "ui/button", version: "1.0.0" });

    await writeFile(path.join(component.rootDir, "index.ts"), "export const id = 'second';\n");
    await snapComponents(store, [component]);

    await expect(
      tagComponent(store, { componentId: "ui/button", version: "1.0.0" })
    ).rejects.toThrow(/component versions are immutable/);
    expect(await runGitLine(store.run, ["rev-parse", `${tag.ref}^{commit}`])).toBe(
      parseObjectId(tag.snapId).hex
    );
  });

  it("keeps versions of different components independent", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const button = await createComponent(workspaceRoot, "ui/button", "button");
    const card = await createComponent(workspaceRoot, "ui/card", "card", "card");
    await snapComponents(store, [button, card]);

    const buttonTag = await tagComponent(store, { componentId: "ui/button", version: "1.0.0" });
    const cardTag = await tagComponent(store, { componentId: "ui/card", version: "1.0.0" });

    expect(buttonTag.ref).not.toBe(cardTag.ref);
    expect(buttonTag.snapId).not.toBe(cardTag.snapId);
  });
});

describe("stored tag validation", () => {
  it("accepts a tag this package created", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    await snapComponents(store, [component]);
    const tag = await tagComponent(store, { componentId: "ui/button", version: "1.0.0" });

    const target = await assertValidComponentTag(store, {
      componentId: "ui/button",
      version: "1.0.0",
      ref: tag.ref,
    });
    expect(target.hex).toBe(parseObjectId(tag.snapId).hex);
  });

  it("rejects a lightweight tag", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    const snap = await snapComponents(store, [component]);
    const ref = componentTagRef("ui/button", "1.0.0");
    await store.run({
      args: ["update-ref", ref, parseObjectId(snap.components[0]!.snapId).hex],
    });

    await expect(
      assertValidComponentTag(store, { componentId: "ui/button", version: "1.0.0", ref })
    ).rejects.toThrow(/must be annotated tags/);
  });

  it("rejects a tag that names another component's snap", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const button = await createComponent(workspaceRoot, "ui/button", "button");
    const card = await createComponent(workspaceRoot, "ui/card", "card", "card");
    const snap = await snapComponents(store, [button, card]);
    const cardSnap = snap.components.find((entry) => entry.componentId === "ui/card")!;

    // Hand-write a tag under ui/button that points at the ui/card snap.
    const ref = componentTagRef("ui/button", "9.0.0");
    await store.run({
      args: [
        "tag",
        "--annotate",
        "--message",
        "hand written",
        ref.slice("refs/tags/".length),
        parseObjectId(cardSnap.snapId).hex,
      ],
    });

    await expect(
      assertValidComponentTag(store, { componentId: "ui/button", version: "9.0.0", ref })
    ).rejects.toThrow(/not reachable from/);
  });

  it("rejects a missing tag", async () => {
    const { store } = await createWorkspace();
    await expect(
      assertValidComponentTag(store, {
        componentId: "ui/button",
        version: "1.0.0",
        ref: componentTagRef("ui/button", "1.0.0"),
      })
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects an annotated tag that does not point at a commit", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    await snapComponents(store, [component]);

    const blobId = await runGitLine(store.run, ["hash-object", "-w", "-t", "blob", "--stdin"]);
    const ref = componentTagRef("ui/button", "8.0.0");
    await store.run({
      args: ["tag", "--annotate", "--message", "blob tag", ref.slice("refs/tags/".length), blobId],
    });

    await expect(
      assertValidComponentTag(store, { componentId: "ui/button", version: "8.0.0", ref })
    ).rejects.toThrow(/does not point at a commit/);
  });
});

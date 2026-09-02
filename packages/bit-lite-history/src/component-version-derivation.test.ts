import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { snapComponents, type SnapRequest } from "./snap.js";
import { openComponentHistoryStore, type ComponentHistoryStore } from "./store.js";
import {
  deriveNextComponentVersion,
  listComponentVersions,
  tagComponent,
} from "./tags.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("deriveNextComponentVersion", () => {
  it("gives a component with no assigned version its first one", () => {
    expect(deriveNextComponentVersion([])).toBe("0.0.1");
  });

  it("increments the patch of a single assigned version", () => {
    expect(deriveNextComponentVersion(["1.4.2"])).toBe("1.4.3");
  });

  it("increments from the highest assigned version rather than the last listed", () => {
    expect(deriveNextComponentVersion(["0.1.0", "0.2.3", "0.0.9"])).toBe("0.2.4");
    expect(deriveNextComponentVersion(["1.0.0", "0.9.9"])).toBe("1.0.1");
  });

  it("orders by semantic precedence, not lexically", () => {
    // "0.10.0" sorts below "0.9.0" as text but above it as a version.
    expect(deriveNextComponentVersion(["0.9.0", "0.10.0"])).toBe("0.10.1");
  });
});

describe("listComponentVersions", () => {
  it("returns nothing for a component with no assigned versions", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    await snapComponents(store, [component]);

    expect(await listComponentVersions(store, "ui/button")).toEqual([]);
  });

  it("returns a component's assigned versions lowest first", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    await snapComponents(store, [component]);

    for (const version of ["0.10.0", "0.2.0", "0.9.0"]) {
      await tagComponent(store, { componentId: "ui/button", version });
    }

    expect(await listComponentVersions(store, "ui/button")).toEqual([
      "0.2.0",
      "0.9.0",
      "0.10.0",
    ]);
  });

  it("ignores versions assigned to another component", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const button = await createComponent(workspaceRoot, "ui/button", "button");
    const math = await createComponent(workspaceRoot, "lib/math", "math");
    await snapComponents(store, [button, math]);

    await tagComponent(store, { componentId: "ui/button", version: "1.0.0" });
    await tagComponent(store, { componentId: "lib/math", version: "2.0.0" });

    expect(await listComponentVersions(store, "ui/button")).toEqual(["1.0.0"]);
    expect(await listComponentVersions(store, "lib/math")).toEqual(["2.0.0"]);
  });

  it("derives the next version from what a component actually carries", async () => {
    const { workspaceRoot, store } = await createWorkspace();
    const component = await createComponent(workspaceRoot, "ui/button", "button");
    await snapComponents(store, [component]);

    expect(deriveNextComponentVersion(await listComponentVersions(store, "ui/button"))).toBe(
      "0.0.1"
    );

    await tagComponent(store, { componentId: "ui/button", version: "0.0.1" });

    expect(deriveNextComponentVersion(await listComponentVersions(store, "ui/button"))).toBe(
      "0.0.2"
    );
  });
});

async function createWorkspace(): Promise<{
  workspaceRoot: string;
  store: ComponentHistoryStore;
}> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-history-derive-"));
  temporaryRoots.push(workspaceRoot);
  return { workspaceRoot, store: await openComponentHistoryStore({ workspaceRoot }) };
}

async function createComponent(
  workspaceRoot: string,
  componentId: string,
  directoryName: string
): Promise<SnapRequest> {
  const rootDir = path.join(workspaceRoot, directoryName);
  await mkdir(rootDir, { recursive: true });
  await writeFile(path.join(rootDir, ".comp.json"), `{"id":"${componentId}"}`);
  return { componentId, rootDir };
}

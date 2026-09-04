import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readWorkspace } from "bit-lite-context";
import { openComponentHistoryStore, type ComponentHistoryStore } from "bit-lite-history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapCommand, type SnapReport } from "../commands/snap.js";
import { inspectWorkspace, type WorkspaceInspection } from "./component-inspection.js";
import type { ParsedCliArgs } from "bit-lite-context";

// Real Git subprocesses against real repositories.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const temporaryRoots: string[] = [];
const silent = { report() {} };

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("workspace inspection", () => {
  it("reports a component with no head as changed and never recorded", async () => {
    const root = await createWorkspace();

    const inspection = await inspect(root);

    const button = inspection.byComponentId.get("ui/button")!;
    expect(button.head).toBeUndefined();
    expect(button.headVersion).toBeUndefined();
    expect(button.ownContentChanged).toBe(true);
  });

  it("reports an unchanged component after recording", async () => {
    const root = await createWorkspace();
    await snap(root);

    const inspection = await inspect(root);

    for (const id of ["envs/react", "lib/math", "ui/button"]) {
      const inspected = inspection.byComponentId.get(id)!;
      expect(inspected.ownContentChanged).toBe(false);
      expect(inspected.changed).toBe(false);
      expect(inspected.headVersion).toBeDefined();
    }
  });

  it("reports a component whose own files changed", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/ui/button/index.ts"), "export const id = 2;\n");

    const inspection = await inspect(root);

    expect(inspection.byComponentId.get("ui/button")?.ownContentChanged).toBe(true);
    expect(inspection.byComponentId.get("lib/math")?.changed).toBe(false);
  });
});

describe("modification propagates over the prerequisite graph", () => {
  it("reports a dependent as changed when only its dependency changed", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");

    const inspection = await inspect(root);

    const button = inspection.byComponentId.get("ui/button")!;
    // ui/button's own bytes are untouched, but recording will still move it.
    expect(button.ownContentChanged).toBe(false);
    expect(button.changed).toBe(true);
    expect(button.changedPrerequisiteIds).toEqual(["lib/math"]);
  });

  it("agrees with what snapping both components actually does", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");

    const inspection = await inspect(root);
    const predicted = [...inspection.byComponentId.values()]
      .filter((inspected) => inspected.changed)
      .map((inspected) => inspected.component.id)
      .sort();
    const report = await snap(root);

    expect(predicted).toEqual(["lib/math", "ui/button"]);
    expect(report.changed.map((item) => item.componentId).sort()).toEqual(predicted);
  });

  it("propagates through an env edge", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(
      path.join(root, "components/envs/react/index.json"),
      JSON.stringify({ name: "react", version: 2 })
    );

    const inspection = await inspect(root);

    const button = inspection.byComponentId.get("ui/button")!;
    expect(button.ownContentChanged).toBe(false);
    expect(button.changed).toBe(true);
    expect(button.changedPrerequisiteIds).toEqual(["envs/react"]);
    // lib/math selects an external env, so nothing reaches it.
    expect(inspection.byComponentId.get("lib/math")?.changed).toBe(false);
  });

  it("names only the direct prerequisite responsible", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");

    const inspection = await inspect(root);

    expect(inspection.byComponentId.get("lib/math")?.changedPrerequisiteIds).toEqual([]);
    expect(inspection.byComponentId.get("ui/button")?.changedPrerequisiteIds).toEqual([
      "lib/math",
    ]);
  });
});

describe("inspection never refuses where recording would", () => {
  it("reports rather than fails when a prerequisite has never been recorded", async () => {
    const root = await createWorkspace();

    // Recording ui/button alone is refused outright in this exact state.
    await expect(snap(root, ["ui/button"])).rejects.toThrow(/has never been snapped/);

    const inspection = await inspect(root);
    expect(inspection.byComponentId.get("lib/math")?.head).toBeUndefined();
    expect(inspection.byComponentId.get("ui/button")?.changed).toBe(true);
  });

  it("reports rather than fails when a prerequisite has uncommitted changes", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 2;\n");

    await expect(snap(root, ["ui/button"])).rejects.toThrow(/has uncommitted changes/);

    const inspection = await inspect(root);
    expect(inspection.byComponentId.get("ui/button")?.changed).toBe(true);
  });
});

describe("inspection leaves the store alone", () => {
  it("adds no objects and moves no refs", async () => {
    const root = await createWorkspace();
    await snap(root);
    const store = await openComponentHistoryStore({ workspaceRoot: root, create: false });

    const objectsBefore = await countObjects(store);
    const refsBefore = await listRefs(store);
    await inspect(root);
    await inspect(root);

    expect(await countObjects(store)).toBe(objectsBefore);
    expect(await listRefs(store)).toBe(refsBefore);
  });
});

async function inspect(root: string): Promise<WorkspaceInspection> {
  const workspace = await readWorkspace(root);
  const store = await openComponentHistoryStore({ workspaceRoot: root });
  return inspectWorkspace(store, workspace);
}

async function snap(root: string, filters: string[] = []): Promise<SnapReport> {
  return runSnapCommand(parsed(root, filters), { reporter: silent });
}

async function countObjects(store: ComponentHistoryStore): Promise<number> {
  const result = await store.run({ args: ["count-objects", "-v"] });
  const line = result.stdout
    .toString("utf8")
    .split("\n")
    .find((entry) => entry.startsWith("count "));
  return Number(line?.slice("count ".length) ?? "0");
}

async function listRefs(store: ComponentHistoryStore): Promise<string> {
  const result = await store.run({ args: ["for-each-ref", "--format=%(refname) %(objectname)"] });
  return result.stdout.toString("utf8");
}

function parsed(workspaceRoot: string, componentFilters: string[] = []): ParsedCliArgs {
  return {
    command: "snap",
    workspaceRoot,
    componentFilters,
    help: false,
    args: {
      raw: ["snap", ...componentFilters.flatMap((filter) => ["--filter", filter])],
      options: componentFilters.length > 0 ? { filter: componentFilters } : {},
      passthrough: [],
    },
  };
}

/** lib/math -> nothing; ui/button -> lib/math and the local env envs/react. */
async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-inspect-"));
  temporaryRoots.push(root);

  const components = [
    {
      path: "components/envs/react",
      id: "envs/react",
      packageName: "@my-scope/env.react",
      env: { packageName: "demo-env-env", version: "0.0.0" },
    },
    {
      path: "components/lib/math",
      id: "lib/math",
      packageName: "@my-scope/lib.math",
      env: { packageName: "demo-env-node", version: "0.0.0" },
    },
    {
      path: "components/ui/button",
      id: "ui/button",
      packageName: "@my-scope/ui.button",
      env: { packageName: "@my-scope/env.react", version: "workspace:*" },
    },
  ];

  await write(
    root,
    "bit-lite.json",
    JSON.stringify({ defaultScope: "my-scope", components }, null, 2)
  );
  await write(root, "components/envs/react/.comp.json", JSON.stringify({ kind: "env" }));
  await write(root, "components/envs/react/index.json", JSON.stringify({ name: "react" }));
  await write(root, "components/lib/math/.comp.json", JSON.stringify({ dependencies: {} }));
  await write(root, "components/lib/math/index.ts", "export const add = 0;\n");
  await write(
    root,
    "components/ui/button/.comp.json",
    JSON.stringify({
      dependencies: { "@my-scope/lib.math": "workspace:*" },
      peerDependencies: { react: "^19.2.7" },
    })
  );
  await write(root, "components/ui/button/index.ts", "export const id = 'ui/button';\n");

  return root;
}

async function write(root: string, relativePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

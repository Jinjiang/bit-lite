import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ParsedCliArgs } from "bit-lite-context";
import { openComponentHistoryStore, readComponentHead } from "bit-lite-history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapCommand } from "./snap.js";
import { runTagCommand, type TagReport } from "./tag.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const temporaryRoots: string[] = [];
const silent = { report() {} };

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("dependency-ordered tagging", () => {
  it("records a dependency's semantic version in its dependent's tagged content", async () => {
    const root = await createWorkspace();
    await snap(root);

    const report = await tag(root);

    const mathVersion = versionOf(report, "lib/math");
    expect(mathVersion).toBe("0.0.1");
    // Not the snap identifier lib/math carried before this operation.
    expect(await recordedConfig(root, "ui/button")).toMatchObject({
      dependencies: { "@my-scope/lib.math": "0.0.1" },
    });
  });

  it("records a local env's semantic version in the components selecting it", async () => {
    const root = await createWorkspace();
    await snap(root);

    const report = await tag(root);

    expect(await recordedConfig(root, "ui/button")).toMatchObject({
      env: { packageName: "@my-scope/env.react", version: versionOf(report, "envs/react") },
    });
  });

  it("creates a snap for a dependent whose dependency versions changed", async () => {
    const root = await createWorkspace();
    await snap(root);
    const store = await openComponentHistoryStore({ workspaceRoot: root, create: false });
    const before = (await readComponentHead(store, "ui/button"))!.hex;

    await tag(root);

    // ui/button's own files never changed, but its recorded metadata did.
    expect((await readComponentHead(store, "ui/button"))!.hex).not.toBe(before);
  });

  it("leaves a leaf component's snap alone when tagging changes nothing", async () => {
    const root = await createWorkspace();
    await snap(root);
    const store = await openComponentHistoryStore({ workspaceRoot: root, create: false });
    const before = (await readComponentHead(store, "lib/math"))!.hex;

    const report = await tag(root);

    // lib/math has no workspace dependencies, so its projection is unchanged.
    expect((await readComponentHead(store, "lib/math"))!.hex).toBe(before);
    expect(report.tags.find((item) => item.componentId === "lib/math")?.snapId).toContain(before);
  });

  it("writes each tagged component's semantic version into the anchor", async () => {
    const root = await createWorkspace();
    await snap(root);

    const report = await tag(root);

    const config = await readConfig(root);
    for (const entry of config.components) {
      expect(entry.version).toBe(versionOf(report, entry.id));
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("keeps an unselected dependency's snap identifier when it has no assigned version", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root, ["envs/react"]);

    const report = await tag(root, ["ui/button"]);

    const recorded = (await recordedConfig(root, "ui/button")) as {
      dependencies: Record<string, string>;
    };
    // lib/math was never tagged, so what ui/button was built against is its snap.
    expect(recorded.dependencies["@my-scope/lib.math"]).toMatch(/^0\.0\.0-g[0-9a-f]{40}$/);
    expect(versionOf(report, "ui/button")).toBe("0.0.1");
  });

  it("uses an unselected dependency's assigned version once it has one", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root, ["lib/math", "envs/react"]);

    await tag(root, ["ui/button"]);

    expect(await recordedConfig(root, "ui/button")).toMatchObject({
      dependencies: { "@my-scope/lib.math": "0.0.1" },
    });
  });

  it("does not churn components when snapping after tagging", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    const report = await runSnapCommand(parsed("snap", root, []), { reporter: silent });

    // snap and tag must answer "what version does this dependency carry" the
    // same way, or every dependent would get a new version on the next snap
    // purely to rewrite semantic versions back to snap identifiers.
    expect(report.changed).toEqual([]);
    expect(report.unchanged).toHaveLength(3);
    expect([...report.versionsByComponentId.values()]).toEqual(["0.0.1", "0.0.1", "0.0.1"]);
  });

  it("propagates a skipped dependency so its dependents are skipped too", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    const report = await tag(root);

    // lib/math is skipped, so ui/button's projection is unchanged and it is
    // skipped in turn -- no version anywhere advances.
    expect(report.tags).toEqual([]);
    expect(report.planned.every((entry) => entry.action === "skip")).toBe(true);
    expect(report.planned.map((entry) => entry.version)).toEqual(["0.0.1", "0.0.1", "0.0.1"]);
  });

  it("refuses to tag a component whose dependency has never been snapped", async () => {
    const root = await createWorkspace();

    await expect(tag(root, ["ui/button"])).rejects.toThrow(/has never been snapped/);
  });

  it("advances no tag ref when the operation fails", async () => {
    const root = await createWorkspace();
    const before = await readFile(path.join(root, "bit-lite.json"), "utf8");

    await expect(tag(root, ["ui/button"])).rejects.toThrow();

    expect(await readFile(path.join(root, "bit-lite.json"), "utf8")).toBe(before);
    const store = await openComponentHistoryStore({ workspaceRoot: root });
    const tags = await store.run({ args: ["for-each-ref", "refs/tags"] });
    expect(tags.stdout.toString("utf8")).toBe("");
  });
});

type ConfigEntry = {
  path: string;
  id: string;
  packageName: string;
  env: { packageName: string; version: string };
  version?: string;
};

function versionOf(report: TagReport, componentId: string): string {
  const tag = report.tags.find((item) => item.componentId === componentId);
  if (!tag) throw new Error(`no tag reported for "${componentId}"`);
  return tag.version;
}

async function snap(root: string, filters: string[] = []): Promise<void> {
  await runSnapCommand(parsed("snap", root, filters), { reporter: silent });
}

async function tag(root: string, filters: string[] = []): Promise<TagReport> {
  return runTagCommand(parsed("tag", root, filters), { reporter: silent });
}

async function readConfig(root: string): Promise<{ components: ConfigEntry[] }> {
  return JSON.parse(await readFile(path.join(root, "bit-lite.json"), "utf8")) as {
    components: ConfigEntry[];
  };
}

async function recordedConfig(root: string, componentId: string): Promise<Record<string, unknown>> {
  const store = await openComponentHistoryStore({ workspaceRoot: root, create: false });
  const head = await readComponentHead(store, componentId);
  if (head === undefined) throw new Error(`component "${componentId}" has no snap`);
  const blob = await store.run({ args: ["cat-file", "blob", `${head.hex}:.comp.json`] });
  return JSON.parse(blob.stdout.toString("utf8")) as Record<string, unknown>;
}

function parsed(command: string, workspaceRoot: string, componentFilters: string[]): ParsedCliArgs {
  return {
    command,
    workspaceRoot,
    componentFilters,
    help: false,
    args: { raw: [command], options: {}, passthrough: [] },
  };
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-tag-order-"));
  temporaryRoots.push(root);

  const components: ConfigEntry[] = [
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

  await write(root, "bit-lite.json", JSON.stringify({ defaultScope: "my-scope", components }, null, 2));
  await write(root, "components/envs/react/.comp.json", JSON.stringify({ kind: "env" }));
  await write(root, "components/envs/react/index.json", JSON.stringify({ name: "react" }));
  await write(root, "components/lib/math/.comp.json", JSON.stringify({ dependencies: {} }));
  await write(root, "components/lib/math/index.ts", "export const add = 0;\n");
  await write(
    root,
    "components/ui/button/.comp.json",
    JSON.stringify({ dependencies: { "@my-scope/lib.math": "workspace:*" } })
  );
  await write(root, "components/ui/button/index.ts", "export const id = 'ui/button';\n");

  return root;
}

async function write(root: string, relativePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ParsedCliArgs } from "../cli/arg-types.js";
import { openComponentHistoryStore } from "bit-lite-history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapCommand } from "./snap.js";
import { createTagReporter, runTagCommand, type TagPlanEntry, type TagReport } from "./tag.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

/**
 * The plan phase is what an interactive selection presents, so it has to be
 * complete before anything is written and it has to say why each component is
 * in the release.
 */
describe("the tag plan", () => {
  it("leaves every ref and every anchor unchanged", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    const refsBefore = await allRefs(root);
    const anchorsBefore = await readFile(path.join(root, "bit-lite.json"), "utf8");

    await touch(root, "components/lib/math/index.ts", "export const add = 1;\n");
    const report = await tag(root, { "dry-run": true });

    // The plan is complete even though nothing was written.
    expect(report.dryRun).toBe(true);
    expect(report.planned.length).toBeGreaterThan(0);
    expect(report.tags).toEqual([]);

    expect(await allRefs(root)).toBe(refsBefore);
    expect(await readFile(path.join(root, "bit-lite.json"), "utf8")).toBe(anchorsBefore);
  });

  it("says what each component currently carries and what it would receive", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    await touch(root, "components/lib/math/index.ts", "export const add = 1;\n");
    const report = await tag(root, { "dry-run": true });

    expect(entry(report, "lib/math")).toMatchObject({
      currentVersion: "0.0.1",
      version: "0.0.2",
      action: "tag",
    });
  });

  it("reports no current version before a component's first release", async () => {
    const root = await createWorkspace();
    await snap(root);

    const report = await tag(root, { "dry-run": true });

    expect(entry(report, "lib/math").currentVersion).toBeUndefined();
  });

  it("attributes a component changed by its own source", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    await touch(root, "components/lib/math/index.ts", "export const add = 1;\n");
    const report = await tag(root, { "dry-run": true });

    expect(entry(report, "lib/math").reason.sources).toContain("source");
  });

  it("attributes a component drawn in only by its dependency, naming that dependency", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    await touch(root, "components/lib/math/index.ts", "export const add = 1;\n");
    const report = await tag(root, { "dry-run": true });

    const button = entry(report, "ui/button");
    // ui/button's own files are untouched; only what it records about lib/math
    // changed, which is the distinction the reason column exists to make.
    expect(button.reason.sources).toEqual(["deps"]);
    expect(button.reason.dependencies.map((change) => change.packageName)).toContain(
      "@my-scope/lib.math"
    );
  });

  it("marks a component that has never been released", async () => {
    const root = await createWorkspace();
    await snap(root);

    // lib/math has a snap but no assigned version, so it has something to
    // release even though nothing about its content is new.
    expect(entry(await tag(root, { "dry-run": true }), "lib/math")).toMatchObject({
      action: "tag",
      reason: expect.objectContaining({ neverReleased: true }),
    });
  });

  it("keeps the human-readable output the split was meant not to change", async () => {
    const root = await createWorkspace();
    await snap(root);

    const lines: string[] = [];
    await runTagCommand(parsed("tag", root, {}), { reporter: createTagReporter((l) => lines.push(l)) });

    expect(lines.at(-1)).toBe("2 components tagged, 0 unchanged");
    expect(lines.filter((line) => line.startsWith("tagged "))).toHaveLength(2);
  });

  it("keeps the structured result's existing facts", async () => {
    const root = await createWorkspace();
    await snap(root);

    const report = await tag(root);
    const button = entry(report, "ui/button");

    // The fields that predate the plan phase still carry what they did.
    expect(button.componentId).toBe("ui/button");
    expect(button.version).toBe("0.0.1");
    expect(button.action).toBe("tag");
    expect(typeof button.createsSnap).toBe("boolean");
    expect(report.tags.map((tag) => tag.componentId).sort()).toEqual(["lib/math", "ui/button"]);
  });
});

function entry(report: TagReport, componentId: string): TagPlanEntry {
  const found = report.planned.find((item) => item.componentId === componentId);
  if (!found) throw new Error(`no plan entry for "${componentId}"`);
  return found;
}

async function allRefs(root: string): Promise<string> {
  const store = await openComponentHistoryStore({ workspaceRoot: root, create: false });
  const result = await store.run({ args: ["for-each-ref", "--format=%(refname) %(objectname)"] });
  return result.stdout.toString("utf8");
}

const silent = { report: () => undefined };

async function snap(root: string): Promise<void> {
  await runSnapCommand(parsed("snap", root, {}), { reporter: silent });
}

async function tag(root: string, options: Record<string, unknown> = {}): Promise<TagReport> {
  return runTagCommand(parsed("tag", root, options), { reporter: silent });
}

function parsed(
  command: string,
  workspaceRoot: string,
  options: Record<string, unknown>
): ParsedCliArgs {
  return {
    command,
    workspaceRoot,
    componentFilters: [],
    help: { kind: "none" },
    consumedBareWords: [],
    args: { raw: [command], options: options as never, passthrough: [] },
  };
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-tag-plan-"));
  temporaryRoots.push(root);

  const components = [
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
      env: { packageName: "demo-env-node", version: "0.0.0" },
    },
  ];

  await touch(
    root,
    "bit-lite.json",
    JSON.stringify({ defaultScope: "my-scope", components }, null, 2)
  );
  await touch(root, "components/lib/math/.comp.json", JSON.stringify({ dependencies: {} }));
  await touch(root, "components/lib/math/index.ts", "export const add = 0;\n");
  await touch(
    root,
    "components/ui/button/.comp.json",
    JSON.stringify({ dependencies: { "@my-scope/lib.math": "workspace:*" } })
  );
  await touch(root, "components/ui/button/index.ts", "export const id = 'ui/button';\n");

  return root;
}

async function touch(root: string, relativePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

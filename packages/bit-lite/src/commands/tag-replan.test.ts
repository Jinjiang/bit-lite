import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readWorkspace, selectWorkspaceComponents } from "bit-lite-context";
import { openComponentHistoryStore } from "bit-lite-history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapCommand } from "./snap.js";
import {
  assertTagReleaseApproved,
  executeTagRelease,
  planTagRelease,
  runTagCommand,
  type TagRelease,
} from "./tag.js";
import { applyVersionExclusions, type VersionDecision } from "../utils/version-decision.js";
import type { ParsedCliArgs } from "bit-lite-context";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

/**
 * Editing a decision re-runs the plan rather than predicting its effect on the
 * dependency graph, so what an interactive selection shows and what execution
 * does are produced by one implementation.
 */
describe("re-planning a release", () => {
  it("draws in every dependent when a skipped component is included", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tagAll(root);

    // Nothing is new, so the default plan releases nothing.
    const before = await plan(root, {});
    expect(before.entries.filter((entry) => entry.action === "tag")).toEqual([]);

    const after = await plan(root, { "lib/math": { kind: "increment", increment: "minor" } });

    expect(tagged(after)).toEqual(["lib/math", "ui/button"]);
    expect(versionOf(after, "lib/math")).toBe("0.1.0");
    // ui/button was drawn in by the cascade, on its own patch increment.
    expect(versionOf(after, "ui/button")).toBe("0.0.2");
  });

  it("adds only the component itself when nothing depends on it", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tagAll(root);

    const after = await plan(root, { "ui/button": { kind: "increment", increment: "major" } });

    expect(tagged(after)).toEqual(["ui/button"]);
  });

  it("leaves membership identical when only an increment changes", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tagAll(root);
    await touch(root, "components/lib/math/index.ts", "export const add = 1;\n");

    const asPatch = await plan(root, {});
    const asMajor = await plan(root, { "lib/math": { kind: "increment", increment: "major" } });

    // The versions differ; who is in the release does not.
    expect(versionOf(asMajor, "lib/math")).toBe("1.0.0");
    expect(versionOf(asPatch, "lib/math")).toBe("0.0.2");
    expect(tagged(asMajor)).toEqual(tagged(asPatch));
  });

  it("removes an excluded component from the release", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tagAll(root);
    await touch(root, "components/ui/button/index.ts", "export const id = 'changed';\n");

    const after = await plan(root, { "ui/button": { kind: "exclude" } });

    expect(after.entries.map((entry) => entry.componentId)).not.toContain("ui/button");
  });

  it("gives the same fingerprint for the same release and a different one otherwise", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tagAll(root);
    await touch(root, "components/lib/math/index.ts", "export const add = 1;\n");

    const first = await plan(root, {});
    const again = await plan(root, {});
    const different = await plan(root, { "lib/math": { kind: "increment", increment: "major" } });

    expect(again.fingerprint).toBe(first.fingerprint);
    expect(different.fingerprint).not.toBe(first.fingerprint);
  });

  it("refuses to carry out a release whose content moved during the review", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tagAll(root);
    await touch(root, "components/lib/math/index.ts", "export const add = 1;\n");

    const approved = await plan(root, {});
    const refsBefore = await allRefs(root);

    // The user edits while the review is open.
    await touch(root, "components/lib/math/index.ts", "export const add = 2;\n");
    const current = await plan(root, {});

    expect(() => assertTagReleaseApproved(approved.fingerprint, current)).toThrow(
      /changed while it was being reviewed/
    );
    expect(await allRefs(root)).toBe(refsBefore);
  });

  it("carries out a release that still matches what was approved", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tagAll(root);
    await touch(root, "components/lib/math/index.ts", "export const add = 1;\n");

    const approved = await plan(root, {});
    const current = await plan(root, {});

    assertTagReleaseApproved(approved.fingerprint, current);
    const tags = await executeTagRelease(current, undefined);

    expect(tags.map((tag) => tag.componentId).sort()).toEqual(["lib/math", "ui/button"]);
  });
});

function tagged(release: TagRelease): string[] {
  return release.entries
    .filter((entry) => entry.action === "tag")
    .map((entry) => entry.componentId)
    .sort();
}

function versionOf(release: TagRelease, componentId: string): string {
  const entry = release.entries.find((item) => item.componentId === componentId);
  if (!entry) throw new Error(`no plan entry for "${componentId}"`);
  return entry.version;
}

async function plan(
  root: string,
  decisions: Record<string, VersionDecision>
): Promise<TagRelease> {
  const workspace = await readWorkspace(root);
  const choices = new Map(Object.entries(decisions));
  const components = applyVersionExclusions(selectWorkspaceComponents(workspace, []), choices);
  return planTagRelease({ workspace, components, choices });
}

async function allRefs(root: string): Promise<string> {
  const store = await openComponentHistoryStore({ workspaceRoot: root, create: false });
  const result = await store.run({ args: ["for-each-ref", "--format=%(refname) %(objectname)"] });
  return result.stdout.toString("utf8");
}

const silent = { report: () => undefined };

async function snap(root: string): Promise<void> {
  await runSnapCommand(parsed("snap", root), { reporter: silent });
}

async function tagAll(root: string): Promise<void> {
  await runTagCommand(parsed("tag", root), { reporter: silent });
}

function parsed(command: string, workspaceRoot: string): ParsedCliArgs {
  return {
    command,
    workspaceRoot,
    componentFilters: [],
    help: false,
    args: { raw: [command], options: {}, passthrough: [] },
  };
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-tag-replan-"));
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

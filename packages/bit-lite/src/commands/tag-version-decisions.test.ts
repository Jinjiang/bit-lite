import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ParsedCliArgs } from "../cli-args-types.js";
import { openComponentHistoryStore, readComponentHead } from "bit-lite-history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapCommand } from "./snap.js";
import { runTagCommand, type TagReport } from "./tag.js";
import type { VersionDecision } from "bit-lite-versioning";

// These drive real Git subprocesses against real repositories.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

/**
 * Every test here builds the decision map directly rather than through an
 * interface. That is the point of keeping the choice a value: the increment
 * rules, the skip override, and exclusion are all reachable without a terminal.
 */
describe("per-component version decisions", () => {
  it("applies a different increment to each component in one release", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    await touch(root, "components/lib/math/index.ts", "export const add = 1;\n");
    await touch(root, "components/ui/button/index.ts", "export const id = 'changed';\n");

    const report = await tag(root, {
      "lib/math": { kind: "increment", increment: "major" },
      "ui/button": { kind: "increment", increment: "minor" },
    });

    expect(versionOf(report, "lib/math")).toBe("1.0.0");
    expect(versionOf(report, "ui/button")).toBe("0.1.0");
  });

  it("assigns an explicit version named for one component", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    await touch(root, "components/lib/math/index.ts", "export const add = 1;\n");

    const report = await tag(root, { "lib/math": { kind: "explicit", version: "2.5.1" } });

    expect(versionOf(report, "lib/math")).toBe("2.5.1");
  });

  it("derives a first version from the requested increment", async () => {
    const root = await createWorkspace();
    await snap(root);

    const report = await tag(root, { "lib/math": { kind: "increment", increment: "minor" } });

    expect(versionOf(report, "lib/math")).toBe("0.1.0");
  });

  it("overrides the skip for a component with nothing new", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    // Nothing changed, so a plain rerun releases nothing.
    const untouched = await tag(root);
    expect(untouched.tags).toHaveLength(0);

    const report = await tag(root, { "lib/math": { kind: "increment", increment: "minor" } });

    expect(versionOf(report, "lib/math")).toBe("0.1.0");
  });

  it("draws dependents in when an override changes what they resolve to", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    const report = await tag(root, { "lib/math": { kind: "increment", increment: "major" } });

    // ui/button depends on lib/math, so the version it records changed.
    expect(versionOf(report, "lib/math")).toBe("1.0.0");
    expect(report.tags.map((tag) => tag.componentId)).toContain("ui/button");
  });

  it("does not let one component's increment reach its dependents", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    const report = await tag(root, { "lib/math": { kind: "increment", increment: "major" } });

    // ui/button was drawn in, but its own increment is still a patch: a break
    // in a dependency's interface is not a break in its dependent's.
    expect(versionOf(report, "lib/math")).toBe("1.0.0");
    expect(versionOf(report, "ui/button")).toBe("0.0.2");
  });

  it("leaves an excluded component at the version it carries, and moves no ref for it", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    const headBefore = await headOf(root, "lib/math");
    await touch(root, "components/ui/button/index.ts", "export const id = 'changed';\n");

    const report = await tag(root, { "lib/math": { kind: "exclude" } });

    expect(report.tags.map((tag) => tag.componentId)).toEqual(["ui/button"]);
    expect(report.planned.map((entry) => entry.componentId)).not.toContain("lib/math");
    expect(await headOf(root, "lib/math")).toBe(headBefore);
  });

  it("refuses to exclude a modified component something in the release depends on", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    // lib/math is modified, and ui/button depends on it. Excluding it would
    // record a combination that was never assembled, so the existing
    // out-of-selection strictness rule refuses the operation.
    await touch(root, "components/lib/math/index.ts", "export const add = 1;\n");

    await expect(tag(root, { "lib/math": { kind: "exclude" } })).rejects.toThrow(
      /lib\/math.*uncommitted changes/s
    );
  });

  it("allows excluding a changed component nothing in the release depends on", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    const headBefore = await headOf(root, "ui/button");
    // ui/button is changed, but nothing depends on it, so no record would be
    // made that names a version it does not match.
    await touch(root, "components/ui/button/index.ts", "export const id = 'changed';\n");

    const report = await tag(root, { "ui/button": { kind: "exclude" } });

    expect(report.planned.map((entry) => entry.componentId)).not.toContain("ui/button");
    expect(await headOf(root, "ui/button")).toBe(headBefore);
  });

  it("fails when every selected component is excluded", async () => {
    const root = await createWorkspace();
    await snap(root);

    await expect(
      tag(root, { "lib/math": { kind: "exclude" }, "ui/button": { kind: "exclude" } })
    ).rejects.toThrow(/every selected component was excluded/);
  });

  it("rejects an explicit version that is not exactly three numbers, naming the component", async () => {
    const root = await createWorkspace();
    await snap(root);

    await expect(
      tag(root, { "lib/math": { kind: "explicit", version: "1.2.3-beta.1" } })
    ).rejects.toThrow(/lib\/math/);
  });

  it("rejects an explicit version in the reserved snap-identifier namespace", async () => {
    const root = await createWorkspace();
    await snap(root);

    await expect(
      tag(root, { "lib/math": { kind: "explicit", version: `0.0.0-g${"a".repeat(40)}` } })
    ).rejects.toThrow(/lib\/math/);
  });

  it("leaves a component the decisions do not mention on the derived patch", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    await touch(root, "components/ui/button/index.ts", "export const id = 'changed';\n");

    const report = await tag(root, {});

    expect(versionOf(report, "ui/button")).toBe("0.0.2");
  });
});

function versionOf(report: TagReport, componentId: string): string {
  const entry = report.planned.find((item) => item.componentId === componentId);
  if (!entry) throw new Error(`no plan entry for "${componentId}"`);
  return entry.version;
}

async function headOf(root: string, componentId: string): Promise<string> {
  const store = await openComponentHistoryStore({ workspaceRoot: root, create: false });
  const head = await readComponentHead(store, componentId);
  if (head === undefined) throw new Error(`component "${componentId}" has no snap`);
  return head.hex;
}

const silent = { report: () => undefined };

async function snap(root: string): Promise<void> {
  await runSnapCommand(parsed("snap", root), { reporter: silent });
}

async function tag(root: string, decisions?: Record<string, VersionDecision>): Promise<TagReport> {
  return runTagCommand(parsed("tag", root), {
    reporter: silent,
    ...(decisions === undefined ? {} : { decisions: new Map(Object.entries(decisions)) }),
  });
}

function parsed(command: string, workspaceRoot: string): ParsedCliArgs {
  return {
    command,
    workspaceRoot,
    componentFilters: [],
    help: { kind: "none" },
    consumedBareWords: [],
    args: { raw: [command], options: {}, passthrough: [] },
  };
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-tag-decisions-"));
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

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ParsedCliArgs } from "../cli/arg-types.js";
import type { CliOptionValue } from "bit-lite-utils";
import { openComponentHistoryStore, readComponentHead } from "bit-lite-history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../cli/args.js";
import { runCli } from "../cli.js";
import { createSnapJsonReporter, runSnapCommand, type SnapReport } from "./snap.js";
import { createTagJsonReporter, runTagCommand, type TagReport } from "./tag.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const temporaryRoots: string[] = [];
const silent = { report() {} };

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("--dry-run", () => {
  it("reports what snap would record without moving a ref or an anchor", async () => {
    const root = await createWorkspace();
    const before = await readFile(path.join(root, "bit-lite.json"), "utf8");

    const report = await snap(root, { "dry-run": true });

    expect(report.dryRun).toBe(true);
    expect(report.changed.map((item) => item.componentId).sort()).toEqual([
      "lib/math",
      "ui/button",
    ]);
    expect(await readFile(path.join(root, "bit-lite.json"), "utf8")).toBe(before);
    const store = await openComponentHistoryStore({ workspaceRoot: root });
    expect(await readComponentHead(store, "ui/button")).toBeUndefined();
  });

  it("reports what tag would assign without creating a tag", async () => {
    const root = await createWorkspace();
    await snap(root);

    const report = await tag(root, { "dry-run": true });

    expect(report.dryRun).toBe(true);
    expect(report.tags).toEqual([]);
    expect(report.planned.map((entry) => [entry.componentId, entry.version])).toEqual([
      ["lib/math", "0.0.1"],
      ["ui/button", "0.0.1"],
    ]);
    const store = await openComponentHistoryStore({ workspaceRoot: root });
    const tags = await store.run({ args: ["for-each-ref", "refs/tags"] });
    expect(tags.stdout.toString("utf8")).toBe("");
  });

  it("says which components tagging would have to snap", async () => {
    const root = await createWorkspace();
    await snap(root);

    const report = await tag(root, { "dry-run": true });

    // ui/button depends on lib/math, so its recorded metadata changes.
    expect(report.planned.find((entry) => entry.componentId === "ui/button")?.createsSnap).toBe(
      true
    );
    expect(report.planned.find((entry) => entry.componentId === "lib/math")?.createsSnap).toBe(
      false
    );
  });

  it("leaves a real run afterwards unaffected", async () => {
    const root = await createWorkspace();

    await snap(root, { "dry-run": true });
    const report = await snap(root);

    expect(report.dryRun).toBe(false);
    expect(report.changed).toHaveLength(2);
  });
});

describe("--json", () => {
  it("emits snap results with complete version identifiers", async () => {
    const root = await createWorkspace();
    const lines: string[] = [];
    await runSnapCommand(parsed("snap", root, { json: true }), {
      reporter: createSnapJsonReporter((line) => lines.push(line)),
    });

    const payload = JSON.parse(lines.join("\n")) as {
      dryRun: boolean;
      components: { componentId: string; version: string }[];
    };
    expect(payload.dryRun).toBe(false);
    for (const component of payload.components) {
      expect(component.version).toMatch(/^0\.0\.0-g[0-9a-f]{40}$/);
    }
  });

  it("emits tag results with the assigned versions", async () => {
    const root = await createWorkspace();
    await snap(root);
    const lines: string[] = [];
    await runTagCommand(parsed("tag", root, { json: true }), {
      reporter: createTagJsonReporter((line) => lines.push(line)),
    });

    const payload = JSON.parse(lines.join("\n")) as {
      components: { componentId: string; version: string; ref?: string }[];
    };
    expect(payload.components.map((item) => item.version)).toEqual(["0.0.1", "0.0.1"]);
    expect(payload.components.every((item) => item.ref?.startsWith("refs/tags/"))).toBe(true);
  });
});

describe("--message", () => {
  it("replaces the generated snap commit message", async () => {
    const root = await createWorkspace();

    await snap(root, { message: "record the initial button" });

    const store = await openComponentHistoryStore({ workspaceRoot: root, create: false });
    const head = (await readComponentHead(store, "ui/button"))!;
    const commit = await store.run({ args: ["log", "-1", "--format=%s", head.hex] });
    expect(commit.stdout.toString("utf8").trim()).toBe("record the initial button");
  });

  it("keeps the generated message when none is supplied", async () => {
    const root = await createWorkspace();

    await snap(root);

    const store = await openComponentHistoryStore({ workspaceRoot: root, create: false });
    const head = (await readComponentHead(store, "ui/button"))!;
    const commit = await store.run({ args: ["log", "-1", "--format=%s", head.hex] });
    expect(commit.stdout.toString("utf8").trim()).toBe("snap ui/button");
  });

  it("replaces the generated tag message", async () => {
    const root = await createWorkspace();
    await snap(root);

    await tag(root, { message: "first release" });

    const store = await openComponentHistoryStore({ workspaceRoot: root, create: false });
    const contents = await store.run({
      args: ["cat-file", "tag", "refs/tags/components/bGliL21hdGg/0.0.1"],
    });
    expect(contents.stdout.toString("utf8")).toContain("first release");
  });

  it("does not turn an unchanged component into a recorded one", async () => {
    const root = await createWorkspace();
    await snap(root);

    const report = await snap(root, { message: "a different message entirely" });

    // Content comparison happens before a commit exists, so the message cannot
    // conjure a version out of a component nothing changed in.
    expect(report.changed).toEqual([]);
    expect(report.unchanged).toHaveLength(2);
  });

  it("rejects a repeated or empty message", async () => {
    const root = await createWorkspace();

    await expect(snap(root, { message: ["one", "two"] })).rejects.toThrow(
      "--message accepts exactly one value"
    );
    await expect(snap(root, { message: "" })).rejects.toThrow("--message requires a value");
  });
});

describe("selection spellings", () => {
  it("records the same components positionally as it does with --filter", async () => {
    const positionalRoot = await createWorkspace();
    const filteredRoot = await createWorkspace();

    const positional = await runSnapCommand(
      parseArgs(["snap", "ui/button", "lib/math", "-w", positionalRoot]),
      { reporter: silent }
    );
    const filtered = await runSnapCommand(
      parseArgs(["snap", "--filter", "ui/button", "--filter", "lib/math", "-w", filteredRoot]),
      { reporter: silent }
    );

    expect(positional.changed.map((item) => item.componentId)).toEqual(
      filtered.changed.map((item) => item.componentId)
    );
    expect(positional.changed.length).toBeGreaterThan(0);
  });
});

describe("an option nobody declared", () => {
  it("stops snap before it writes, rather than recording with the flag unset", async () => {
    const root = await createWorkspace();
    const before = await readFile(path.join(root, "bit-lite.json"), "utf8");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    // One missing hyphen. This used to perform a real recording and report success.
    expect(await runCli(["snap", "--dryrun", "-w", root])).toBe(1);

    expect(errors.mock.calls.flat().join("\n")).toContain("--dryrun");
    expect(await readFile(path.join(root, "bit-lite.json"), "utf8")).toBe(before);
    const store = await openComponentHistoryStore({ workspaceRoot: root });
    expect(await readComponentHead(store, "ui/button")).toBeUndefined();
    errors.mockRestore();
  });
});

describe("asking a recording command for help", () => {
  it("prints tag's help and moves nothing", async () => {
    const root = await createWorkspace();
    await snap(root);
    const store = await openComponentHistoryStore({ workspaceRoot: root });
    const headBefore = await readComponentHead(store, "ui/button");
    const configBefore = await readFile(path.join(root, "bit-lite.json"), "utf8");
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await runCli(["tag", "-h", "-w", root])).toBe(0);

    expect(logs.mock.calls.flat().join("\n")).toContain("--interactive");
    expect(await readComponentHead(store, "ui/button")).toEqual(headBefore);
    expect(await readFile(path.join(root, "bit-lite.json"), "utf8")).toBe(configBefore);
    logs.mockRestore();
  });
});

async function snap(
  root: string,
  options: Record<string, CliOptionValue> = {}
): Promise<SnapReport> {
  return runSnapCommand(parsed("snap", root, options), { reporter: silent });
}

async function tag(
  root: string,
  options: Record<string, CliOptionValue> = {}
): Promise<TagReport> {
  return runTagCommand(parsed("tag", root, options), { reporter: silent });
}

function parsed(
  command: string,
  workspaceRoot: string,
  options: Record<string, CliOptionValue>
): ParsedCliArgs {
  return {
    command,
    workspaceRoot,
    componentFilters: [],
    help: { kind: "none" },
    consumedBareWords: [],
    args: { raw: [command], options, passthrough: [] },
  };
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-options-"));
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

  await write(root, "bit-lite.json", JSON.stringify({ components }, null, 2));
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

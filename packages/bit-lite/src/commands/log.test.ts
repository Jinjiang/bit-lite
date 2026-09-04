import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapCommand, type SnapReport } from "./snap.js";
import { runTagCommand } from "./tag.js";
import { createLogReporter, runLogCommand, type LogReport } from "./log.js";
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

describe("listing a component's history", () => {
  it("lists snaps from the head backwards", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    await snap(root, ["lib/math"]);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 2;\n");
    const third = await snap(root, ["lib/math"]);

    const report = await log(root, ["lib/math"]);

    expect(report.entries).toHaveLength(3);
    expect(report.entries[0]?.snapVersion).toBe(third.versionsByComponentId.get("lib/math"));
    expect(report.entries.at(-1)?.initial).toBe(true);
  });

  it("carries an authored timestamp on every entry", async () => {
    const root = await createWorkspace();
    await snap(root);

    const report = await log(root, ["lib/math"]);

    expect(Number.isNaN(Date.parse(report.entries[0]!.authoredAt))).toBe(false);
  });

  it("lists no snap belonging to another component", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    await snap(root, ["lib/math"]);

    expect((await log(root, ["lib/math"])).entries).toHaveLength(2);
    expect((await log(root, ["envs/react"])).entries).toHaveLength(1);
  });

  it("reports a component with no history as never recorded without failing", async () => {
    const root = await createWorkspace();

    const report = await log(root, ["lib/math"]);

    expect(report.neverRecorded).toBe(true);
    expect(report.entries).toEqual([]);
  });

  it("reports never recorded when the workspace has no store", async () => {
    const root = await createWorkspace();

    const lines = await humanOutput(root, ["lib/math"]);

    expect(lines).toEqual(["lib/math has never been recorded"]);
  });
});

describe("tag decoration", () => {
  it("shows every semantic version assigned to a snap", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root, ["lib/math"]);
    await tag(root, ["lib/math"], "1.2.3");

    const report = await log(root, ["lib/math"]);

    expect(report.entries[0]?.versions).toEqual(["0.0.1", "1.2.3"]);
  });

  it("leaves an untagged snap undecorated", async () => {
    const root = await createWorkspace();
    await snap(root);

    expect((await log(root, ["lib/math"])).entries[0]?.versions).toEqual([]);
  });
});

describe("change source attribution", () => {
  it("reports the first snap as the initial version", async () => {
    const root = await createWorkspace();
    await snap(root);

    const entry = (await log(root, ["lib/math"])).entries[0]!;

    expect(entry.initial).toBe(true);
    expect(entry.sources).toEqual([]);
  });

  it("reports source for a change in component-owned files", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    await snap(root, ["lib/math"]);

    expect((await log(root, ["lib/math"])).entries[0]?.sources).toEqual(["source"]);
  });

  it("reports a deps-only version with both dependency versions", async () => {
    const root = await createWorkspace();
    const first = await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    const second = await snap(root);

    const entry = (await log(root, ["ui/button"])).entries[0]!;

    expect(entry.sources).toEqual(["deps"]);
    expect(entry.changedFileCount).toBe(0);
    expect(entry.dependencyChanges).toEqual([
      {
        field: "dependencies",
        packageName: "@my-scope/lib.math",
        before: first.versionsByComponentId.get("lib/math"),
        after: second.versionsByComponentId.get("lib/math"),
        status: "changed",
      },
    ]);
  });

  it("reports an env-only version with both env versions", async () => {
    const root = await createWorkspace();
    const first = await snap(root);
    await writeFile(
      path.join(root, "components/envs/react/index.json"),
      JSON.stringify({ name: "react", version: 2 })
    );
    const second = await snap(root);

    const entry = (await log(root, ["ui/button"])).entries[0]!;

    expect(entry.sources).toEqual(["env"]);
    expect(entry.changedFileCount).toBe(0);
    expect(entry.envChange).toEqual({
      before: {
        packageName: "@my-scope/env.react",
        version: first.versionsByComponentId.get("envs/react"),
      },
      after: {
        packageName: "@my-scope/env.react",
        version: second.versionsByComponentId.get("envs/react"),
      },
    });
  });

  it("says plainly that no source file changed on a dependency-driven version", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    await snap(root);

    const lines = await humanOutput(root, ["ui/button"]);

    expect(lines.join("\n")).toContain("no component-owned source file changed");
    expect(lines.join("\n")).toContain("@my-scope/lib.math");
  });

  it("reports both sources when files and dependencies moved together", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    await writeFile(path.join(root, "components/ui/button/index.ts"), "export const id = 2;\n");
    await snap(root);

    expect((await log(root, ["ui/button"])).entries[0]?.sources).toEqual(["source", "deps"]);
  });
});

describe("selection", () => {
  it("fails when the selection matches more than one component", async () => {
    const root = await createWorkspace();
    await snap(root);

    await expect(log(root, [])).rejects.toThrow(/log reports one component, but the selection/);
  });

  it("names the matched components in the diagnostic", async () => {
    const root = await createWorkspace();

    await expect(log(root, [])).rejects.toThrow(/envs\/react, lib\/math, ui\/button/);
  });

  it("fails when a filter matches nothing", async () => {
    const root = await createWorkspace();

    await expect(log(root, ["ui/absent"])).rejects.toThrow(/did not match any components/);
  });
});

describe("output", () => {
  it("abbreviates identifiers for reading but never in structured output", async () => {
    const root = await createWorkspace();
    const report = await snap(root);
    const full = report.versionsByComponentId.get("lib/math")!;

    const lines = await humanOutput(root, ["lib/math"]);

    expect(lines[0]).not.toContain(full);
    expect((await log(root, ["lib/math"])).entries[0]?.snapVersion).toBe(full);
  });
});

async function log(root: string, filters: string[] = []): Promise<LogReport> {
  return runLogCommand(parsed(root, filters), { reporter: silent });
}

async function humanOutput(root: string, filters: string[] = []): Promise<string[]> {
  const lines: string[] = [];
  await runLogCommand(parsed(root, filters), {
    reporter: createLogReporter((message) => lines.push(message)),
  });
  return lines;
}

async function snap(root: string, filters: string[] = []): Promise<SnapReport> {
  return runSnapCommand(parsed(root, filters), { reporter: silent });
}

async function tag(root: string, filters: string[] = [], version?: string): Promise<void> {
  const args = parsed(root, filters);
  if (version !== undefined) args.args.options.version = version;
  await runTagCommand(args, { reporter: silent });
}

function parsed(workspaceRoot: string, componentFilters: string[] = []): ParsedCliArgs {
  return {
    command: "log",
    workspaceRoot,
    componentFilters,
    help: false,
    args: {
      raw: ["log", ...componentFilters.flatMap((filter) => ["--filter", filter])],
      options: componentFilters.length > 0 ? { filter: componentFilters } : {},
      passthrough: [],
    },
  };
}

/** lib/math -> nothing; ui/button -> lib/math and the local env envs/react. */
async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-log-"));
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

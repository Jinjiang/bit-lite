import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapCommand, type SnapReport } from "./snap.js";
import { runTagCommand } from "./tag.js";
import { createDiffReporter, runDiffCommand, type DiffReport } from "./diff.js";
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

describe("diff and snap agree on whether a component changed", () => {
  it("reports no changes exactly when snapping reports the component unchanged", async () => {
    const root = await createWorkspace();
    await snap(root);

    const report = await diff(root, ["ui/button"]);
    const second = await snap(root);

    expect(report.changed).toBe(false);
    expect(second.changed).toEqual([]);
  });

  it("reports a change when only a dependency version moved", async () => {
    const root = await createWorkspace();
    const first = await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    const afterMath = await snap(root, ["lib/math"]);

    const report = await diff(root, ["ui/button"]);

    expect(report.changed).toBe(true);
    expect(report.files).toEqual([]);
    expect(report.dependencies).toEqual([
      {
        field: "dependencies",
        packageName: "@my-scope/lib.math",
        before: first.versionsByComponentId.get("lib/math"),
        after: afterMath.versionsByComponentId.get("lib/math"),
        status: "changed",
      },
    ]);
    expect((await snap(root)).changed.map((item) => item.componentId)).toContain("ui/button");
  });

  it("reports a change when a prerequisite has uncommitted changes", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");

    const report = await diff(root, ["ui/button"]);

    // Nothing in ui/button's own projection has moved yet, but recording both
    // will still advance it, so an "unchanged" answer here would be a lie.
    expect(report.files).toEqual([]);
    expect(report.dependencies).toEqual([]);
    expect(report.modifiedBy).toEqual(["lib/math"]);
    expect(report.changed).toBe(true);

    const recorded = await snap(root);
    expect(recorded.changed.map((item) => item.componentId).sort()).toEqual([
      "lib/math",
      "ui/button",
    ]);
  });
});

describe("comparing working state against the head", () => {
  it("lists added, modified, and deleted component files", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/ui/button/index.ts"), "export const id = 2;\n");
    await writeFile(path.join(root, "components/ui/button/extra.ts"), "export const x = 1;\n");
    await rm(path.join(root, "components/ui/button/README.md"));

    const report = await diff(root, ["ui/button"]);

    expect(report.files).toEqual([
      { path: "README.md", status: "deleted" },
      { path: "extra.ts", status: "added" },
      { path: "index.ts", status: "modified" },
    ]);
  });

  it("never lists .comp.json as a changed file", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(
      path.join(root, "components/ui/button/.comp.json"),
      JSON.stringify({
        dependencies: { "@my-scope/lib.math": "workspace:*" },
        peerDependencies: { react: "^19.2.7" },
        devDependencies: { typescript: "^5.9.0" },
      })
    );

    const report = await diff(root, ["ui/button"]);

    expect(report.files.map((change) => change.path)).not.toContain(".comp.json");
    expect(report.dependencies).toEqual([
      {
        field: "devDependencies",
        packageName: "typescript",
        before: undefined,
        after: "^5.9.0",
        status: "added",
      },
    ]);
  });

  it("reports a component that has never been recorded", async () => {
    const root = await createWorkspace();

    const report = await diff(root, ["ui/button"]);

    expect(report.from).toEqual({ kind: "absent" });
    expect(report.to).toEqual({ kind: "working" });
  });
});

describe("comparing recorded versions", () => {
  it("compares two snaps named by their identifiers", async () => {
    const root = await createWorkspace();
    const first = await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    const second = await snap(root, ["lib/math"]);

    const report = await diff(root, ["lib/math"], {
      from: first.versionsByComponentId.get("lib/math"),
      to: second.versionsByComponentId.get("lib/math"),
    });

    expect(report.files).toEqual([{ path: "index.ts", status: "modified" }]);
    expect(report.modifiedBy).toEqual([]);
  });

  it("does not read working content into a snap-versus-snap comparison", async () => {
    const root = await createWorkspace();
    const first = await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    const second = await snap(root, ["lib/math"]);
    // Working content moves again, after both recorded points.
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 99;\n");

    const report = await diff(root, ["lib/math"], {
      from: first.versionsByComponentId.get("lib/math"),
      to: second.versionsByComponentId.get("lib/math"),
    });

    expect(report.files).toEqual([{ path: "index.ts", status: "modified" }]);
    expect(report.to).toMatchObject({ kind: "snap" });
  });

  it("compares two assigned semantic versions", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root, ["lib/math"]);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    await snap(root, ["lib/math"]);
    await tag(root, ["lib/math"]);

    const report = await diff(root, ["lib/math"], { from: "0.0.1", to: "0.0.2" });

    expect(report.files).toEqual([{ path: "index.ts", status: "modified" }]);
    expect(report.from).toMatchObject({ kind: "snap", version: "0.0.1" });
    expect(report.to).toMatchObject({ kind: "snap", version: "0.0.2" });
  });

  it("compares a named version against working content", async () => {
    const root = await createWorkspace();
    const first = await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");

    const report = await diff(root, ["lib/math"], {
      from: first.versionsByComponentId.get("lib/math"),
    });

    expect(report.to).toEqual({ kind: "working" });
    expect(report.files).toEqual([{ path: "index.ts", status: "modified" }]);
  });
});

describe("unresolvable versions", () => {
  it("fails naming the component and the version", async () => {
    const root = await createWorkspace();
    await snap(root);

    await expect(diff(root, ["lib/math"], { from: "9.9.9" })).rejects.toThrow(
      'component "lib/math" has no version "9.9.9"'
    );
  });

  it("refuses a snap identifier that names no commit", async () => {
    const root = await createWorkspace();
    await snap(root);

    await expect(
      diff(root, ["lib/math"], { from: `0.0.0-g${"0".repeat(40)}` })
    ).rejects.toThrow(/has no version/);
  });

  it("refuses a version belonging to another component's history", async () => {
    const root = await createWorkspace();
    const first = await snap(root);

    await expect(
      diff(root, ["lib/math"], { to: first.versionsByComponentId.get("ui/button") })
    ).rejects.toThrow(/has no version/);
  });

  it("refuses a named version when the component has no history", async () => {
    const root = await createWorkspace();
    await snap(root, ["lib/math"]);

    await expect(diff(root, ["ui/button"], { from: "0.0.1" })).rejects.toThrow(
      /has no version/
    );
  });
});

describe("selection", () => {
  it("fails when the selection matches more than one component", async () => {
    const root = await createWorkspace();

    await expect(diff(root, [])).rejects.toThrow(/diff reports one component/);
  });

  it("fails when a filter matches nothing", async () => {
    const root = await createWorkspace();

    await expect(diff(root, ["ui/absent"])).rejects.toThrow(/did not match any components/);
  });
});

describe("output", () => {
  it("presents dependency and env changes apart from files", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    await snap(root, ["lib/math"]);
    await writeFile(path.join(root, "components/ui/button/index.ts"), "export const id = 2;\n");

    const output = (await humanOutput(root, ["ui/button"])).join("\n");

    expect(output).toContain("  source");
    expect(output).toContain("    M  index.ts");
    expect(output).toContain("  dependencies");
    expect(output).toContain("@my-scope/lib.math");
    expect(output).not.toContain(".comp.json");
  });

  it("says so plainly when nothing changed", async () => {
    const root = await createWorkspace();
    await snap(root);

    expect((await humanOutput(root, ["ui/button"])).join("\n")).toContain("no changes");
  });

  it("abbreviates versions for reading but never in structured output", async () => {
    const root = await createWorkspace();
    const report = await snap(root);
    const full = report.versionsByComponentId.get("lib/math")!;

    const output = (await humanOutput(root, ["lib/math"])).join("\n");

    expect(output).not.toContain(full);
    expect((await diff(root, ["lib/math"])).from).toMatchObject({ version: full });
  });
});

type Sides = { from?: string | undefined; to?: string | undefined };

async function diff(
  root: string,
  filters: string[] = [],
  sides: Sides = {}
): Promise<DiffReport> {
  return runDiffCommand(parsed(root, filters, sides), { reporter: silent });
}

async function humanOutput(
  root: string,
  filters: string[] = [],
  sides: Sides = {}
): Promise<string[]> {
  const lines: string[] = [];
  await runDiffCommand(parsed(root, filters, sides), {
    reporter: createDiffReporter((message) => lines.push(message)),
  });
  return lines;
}

async function snap(root: string, filters: string[] = []): Promise<SnapReport> {
  return runSnapCommand(parsed(root, filters), { reporter: silent });
}

async function tag(root: string, filters: string[] = []): Promise<void> {
  await runTagCommand(parsed(root, filters), { reporter: silent });
}

function parsed(
  workspaceRoot: string,
  componentFilters: string[] = [],
  sides: Sides = {}
): ParsedCliArgs {
  const options: Record<string, string | string[]> = {};
  if (componentFilters.length > 0) options.filter = componentFilters;
  if (sides.from !== undefined) options.from = sides.from;
  if (sides.to !== undefined) options.to = sides.to;

  return {
    command: "diff",
    workspaceRoot,
    componentFilters,
    help: false,
    args: {
      raw: ["diff", ...componentFilters.flatMap((filter) => ["--filter", filter])],
      options,
      passthrough: [],
    },
  };
}

/** lib/math -> nothing; ui/button -> lib/math and the local env envs/react. */
async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-diff-"));
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
  await write(root, "components/ui/button/README.md", "# button\n");

  return root;
}

async function write(root: string, relativePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

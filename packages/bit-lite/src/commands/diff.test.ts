import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapCommand, type SnapReport } from "./snap.js";
import { runTagCommand } from "./tag.js";
import { createDiffReporter, runDiffCommand, type DiffReport } from "./diff.js";
import type { ParsedCliArgs } from "../cli-args-types.js";

// Real Git subprocesses against real repositories.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const temporaryRoots: string[] = [];
const silent = { report() {} };

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("comparing working state against the head", () => {
  it("emits hunks for added, modified, and deleted component files", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/ui/button/index.ts"), "export const id = 2;\n");
    await writeFile(path.join(root, "components/ui/button/extra.ts"), "export const x = 1;\n");
    await rm(path.join(root, "components/ui/button/README.md"));

    const { patch } = await diff(root, ["ui/button"]);

    expect(patch).toContain("diff --git a/ui/button::index.ts b/ui/button::index.ts");
    expect(patch).toContain("-export const id = 'ui/button';");
    expect(patch).toContain("+export const id = 2;");
    expect(patch).toContain("new file mode");
    expect(patch).toContain("+++ b/ui/button::extra.ts");
    expect(patch).toContain("deleted file mode");
    expect(patch).toContain("--- a/ui/button::README.md");
  });

  it("includes .comp.json as an ordinary file patch", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    await snap(root, ["lib/math"]);

    const { patch } = await diff(root, ["ui/button"]);

    // The dependency substitution that produces ui/button's next version is
    // visible in the recorded bytes, which is the whole point of not hiding it.
    expect(patch).toContain("diff --git a/ui/button::.comp.json b/ui/button::.comp.json");
    expect(patch).toContain("@my-scope/lib.math");
  });

  it("reports a component that has never been recorded with an empty patch", async () => {
    const root = await createWorkspace();

    const report = await diff(root, ["ui/button"]);

    expect(report.patch).toBe("");
    expect(report.components).toEqual([]);
  });
});

describe("comparing recorded versions", () => {
  it("compares two snaps named by their identifiers", async () => {
    const root = await createWorkspace();
    const first = await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    const second = await snap(root, ["lib/math"]);

    const { patch, components } = await diff(root, ["lib/math"], {
      from: first.versionsByComponentId.get("lib/math"),
      to: second.versionsByComponentId.get("lib/math"),
    });

    expect(components[0]!.changedPaths).toContain("index.ts");
    expect(patch).toContain("-export const add = 0;");
    expect(patch).toContain("+export const add = 1;");
  });

  it("does not read working content into a snap-versus-snap comparison", async () => {
    const root = await createWorkspace();
    const first = await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    const second = await snap(root, ["lib/math"]);
    // Working content moves again, after both recorded points.
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 99;\n");

    const { patch } = await diff(root, ["lib/math"], {
      from: first.versionsByComponentId.get("lib/math"),
      to: second.versionsByComponentId.get("lib/math"),
    });

    expect(patch).toContain("+export const add = 1;");
    // Asserted against the line, not the bare number: blob ids on the index
    // line are hex, so a substring check for "99" matches them by chance.
    expect(patch).not.toContain("add = 99");
  });

  it("compares two assigned semantic versions", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root, ["lib/math"]);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    await snap(root, ["lib/math"]);
    await tag(root, ["lib/math"]);

    const { patch, components } = await diff(root, ["lib/math"], { from: "0.0.1", to: "0.0.2" });

    expect(patch).toContain("# lib/math  0.0.1 -> 0.0.2");
    expect(components[0]!.from).toMatchObject({ kind: "snap", version: "0.0.1" });
    expect(components[0]!.to).toMatchObject({ kind: "snap", version: "0.0.2" });
  });

  it("compares a named version against working content", async () => {
    const root = await createWorkspace();
    const first = await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");

    const { patch, components } = await diff(root, ["lib/math"], {
      from: first.versionsByComponentId.get("lib/math"),
    });

    expect(components[0]!.to).toEqual({ kind: "working" });
    expect(patch).toContain("-> working");
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
  it("covers every changed component when no version is named", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    await writeFile(path.join(root, "components/ui/button/index.ts"), "export const id = 2;\n");

    const { patch } = await diff(root);

    expect(patch).toContain("# lib/math");
    expect(patch).toContain("# ui/button");
    // Ordered by component identifier, so the patch is stable across runs.
    expect(patch.indexOf("# lib/math")).toBeLessThan(patch.indexOf("# ui/button"));
  });

  it("fails when a version is named and the selection matches more than one", async () => {
    const root = await createWorkspace();
    await snap(root);

    await expect(diff(root, [], { from: "0.0.1" })).rejects.toThrow(
      /naming a version compares one component/
    );
  });

  it("fails when a filter matches nothing", async () => {
    const root = await createWorkspace();

    await expect(diff(root, ["ui/absent"])).rejects.toThrow(/did not match any components/);
  });
});

describe("the patch is the output contract", () => {
  it("writes the patch and nothing else to standard output", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");

    const written = await stdout(root, ["lib/math"]);

    // Every line is either a banner or something unified diff defines.
    for (const line of written.split("\n")) {
      if (line.length === 0) continue;
      expect(line).toMatch(/^(#|diff --git |index |old mode |new mode |new file mode |deleted file mode |Binary files |--- |\+\+\+ |@@ |[-+ ])/);
    }
    expect(written.endsWith("\n")).toBe(true);
  });

  it("begins no banner line with a character unified diff gives meaning to", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");

    for (const line of (await stdout(root, ["lib/math"])).split("\n")) {
      if (!line.startsWith("#")) continue;
      expect(["-", "+", "@", " ", "\\"]).not.toContain(line[0]);
    }
  });

  it("writes nothing at all when no content differs", async () => {
    const root = await createWorkspace();
    await snap(root);

    expect(await stdout(root, ["ui/button"])).toBe("");
  });

  it("keeps two components owning a file of the same name distinct", async () => {
    const root = await createWorkspace();
    await write(root, "components/lib/math/shared.ts", "export const shared = 0;\n");
    await write(root, "components/ui/button/shared.ts", "export const shared = 0;\n");
    await snap(root);
    await write(root, "components/lib/math/shared.ts", "export const shared = 1;\n");
    await write(root, "components/ui/button/shared.ts", "export const shared = 2;\n");

    const { patch } = await diff(root);

    expect(patch).toContain("diff --git a/lib/math::shared.ts b/lib/math::shared.ts");
    expect(patch).toContain("diff --git a/ui/button::shared.ts b/ui/button::shared.ts");
  });
});

describe("what a patch cannot show", () => {
  it("emits an empty patch for a component moved only by a prerequisite", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");

    const advisories: string[] = [];
    const report = await runDiffCommand(parsed(root, ["ui/button"]), {
      reporter: silent,
      logAdvisory: (message) => advisories.push(message),
    });

    // Nothing in ui/button's own content has moved, because inspection resolves
    // lib/math to the version at its own head. Recording will still advance it.
    expect(report.patch).toBe("");
    expect(report.components[0]!.modifiedBy).toEqual(["lib/math"]);
    expect(advisories.join("\n")).toContain("lib/math");
    expect(advisories.join("\n")).toContain("will move this component when recorded");

    const recorded = await snap(root);
    expect(recorded.changed.map((item) => item.componentId).sort()).toEqual([
      "lib/math",
      "ui/button",
    ]);
  });

  it("says nothing on standard error when the patch explains itself", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");

    const advisories: string[] = [];
    await runDiffCommand(parsed(root, ["lib/math"]), {
      reporter: silent,
      logAdvisory: (message) => advisories.push(message),
    });

    expect(advisories).toEqual([]);
  });
});

describe("structured output", () => {
  it("carries the patch and unabbreviated version identifiers", async () => {
    const root = await createWorkspace();
    const report = await snap(root);
    const full = report.versionsByComponentId.get("lib/math")!;
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");

    const structured = await diff(root, ["lib/math"]);

    expect(structured.components[0]!.from).toMatchObject({ version: full });
    expect(structured.patch).toContain("@@");
    // The human-readable patch abbreviates the same version in its banner.
    expect(structured.patch).not.toContain(full);
  });
});

type Sides = { from?: string | undefined; to?: string | undefined };

async function diff(
  root: string,
  filters: string[] = [],
  sides: Sides = {}
): Promise<DiffReport> {
  return runDiffCommand(parsed(root, filters, sides), {
    reporter: silent,
    logAdvisory: () => {},
  });
}

/** Exactly what the command would write to standard output. */
async function stdout(root: string, filters: string[] = [], sides: Sides = {}): Promise<string> {
  let written = "";
  await runDiffCommand(parsed(root, filters, sides), {
    reporter: createDiffReporter((chunk) => {
      written += chunk;
    }),
    logAdvisory: () => {},
  });
  return written;
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
    help: { kind: "none" },
    consumedBareWords: [],
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

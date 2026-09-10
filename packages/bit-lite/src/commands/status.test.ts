import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  componentHeadRef,
  openComponentHistoryStore,
  resolveComponentStorePath,
} from "bit-lite-history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapCommand, type SnapReport } from "./snap.js";
import { runTagCommand } from "./tag.js";
import {
  createStatusReporter,
  runStatusCommand,
  type ComponentStatus,
  type StatusReport,
} from "./status.js";
import type { ParsedCliArgs } from "../cli/arg-types.js";

// Real Git subprocesses against real repositories.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const temporaryRoots: string[] = [];
const silent = { report() {} };

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

function find(report: StatusReport, componentId: string): ComponentStatus {
  const status = report.components.find((item) => item.componentId === componentId);
  if (status === undefined) throw new Error(`no status for "${componentId}"`);
  return status;
}

describe("never recorded", () => {
  it("reports every component as never recorded before anything is snapped", async () => {
    const root = await createWorkspace();

    const report = await status(root);

    expect(report.components).toHaveLength(3);
    for (const component of report.components) {
      expect(component.neverRecorded).toBe(true);
      expect(component.headVersion).toBeUndefined();
      expect(component.clean).toBe(false);
    }
  });

  it("creates no store when the workspace has none", async () => {
    const root = await createWorkspace();

    const report = await status(root);

    expect(report.storePath).toBeUndefined();
    await expect(readFile(resolveComponentStorePath(root))).rejects.toThrow();
  });

  it("reports a component with no history alongside recorded ones", async () => {
    const root = await createWorkspace();
    await snap(root, ["lib/math"]);

    const report = await status(root);

    expect(find(report, "lib/math").neverRecorded).toBe(false);
    expect(find(report, "envs/react").neverRecorded).toBe(true);
  });
});

describe("modified and clean", () => {
  it("reports a component whose files changed as modified", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/ui/button/index.ts"), "export const id = 2;\n");

    const report = await status(root);

    expect(find(report, "ui/button").modified).toBe(true);
    expect(find(report, "ui/button").clean).toBe(false);
  });

  it("reports a component modified only because a prerequisite is", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");

    const report = await status(root);

    const button = find(report, "ui/button");
    expect(button.modified).toBe(true);
    expect(button.modifiedBy).toEqual(["lib/math"]);
  });

  it("reports a component with nothing outstanding as clean", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    const report = await status(root);

    for (const component of report.components) {
      expect(component.clean).toBe(true);
      expect(component.modified).toBe(false);
      expect(component.neverReleased).toBe(false);
    }
  });
});

describe("never released", () => {
  it("reports a snapped but untagged component as never released", async () => {
    const root = await createWorkspace();
    await snap(root);

    const report = await status(root);

    const math = find(report, "lib/math");
    expect(math.neverReleased).toBe(true);
    expect(math.modified).toBe(false);
    expect(math.clean).toBe(false);
  });

  it("stops reporting it once a version is assigned", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    expect(find(await status(root), "lib/math").neverReleased).toBe(false);
  });
});

describe("behind", () => {
  it("reports a component whose anchor names an ancestor of its head", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    const second = await snap(root);
    // Stand in for what sync does: advance the head, leave the anchor behind.
    await rewindAnchor(root, "lib/math");

    const report = await status(root);

    const math = find(report, "lib/math");
    expect(math.behind).toBe(true);
    expect(math.headVersion).toBe(second.versionsByComponentId.get("lib/math"));
    expect(math.anchoredVersion).toBeDefined();
    expect(math.anchoredVersion).not.toBe(math.headVersion);
  });

  it("resolves an anchor holding a semantic version", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);
    const taggedAnchor = await readAnchor(root, "lib/math");
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    await snap(root);
    await setAnchor(root, "lib/math", taggedAnchor!);

    const math = find(await status(root), "lib/math");

    expect(math.anchoredVersion).toBe(taggedAnchor);
    expect(math.behind).toBe(true);
  });

  it("states the consequence of recording from a behind state", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    await snap(root);
    await rewindAnchor(root, "lib/math");

    const lines = await humanOutput(root, ["lib/math"]);

    expect(lines.join("\n")).toContain("recording from here would record content based on the older version");
  });

  it("does not report a component whose anchor matches its head", async () => {
    const root = await createWorkspace();
    await snap(root);

    expect(find(await status(root), "lib/math").behind).toBe(false);
  });
});

describe("dependency updates", () => {
  it("names the dependency and both versions", async () => {
    const root = await createWorkspace();
    const first = await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    const second = await snap(root, ["lib/math"]);

    const button = find(await status(root), "ui/button");

    expect(button.dependencyUpdates).toEqual([
      {
        kind: "dependency",
        packageName: "@my-scope/lib.math",
        recorded: first.versionsByComponentId.get("lib/math"),
        current: second.versionsByComponentId.get("lib/math"),
      },
    ]);
  });

  it("names an env that moved on", async () => {
    const root = await createWorkspace();
    const first = await snap(root);
    await writeFile(
      path.join(root, "components/envs/react/index.json"),
      JSON.stringify({ name: "react", version: 2 })
    );
    const second = await snap(root, ["envs/react"]);

    const button = find(await status(root), "ui/button");

    expect(button.dependencyUpdates).toEqual([
      {
        kind: "env",
        packageName: "@my-scope/env.react",
        recorded: first.versionsByComponentId.get("envs/react"),
        current: second.versionsByComponentId.get("envs/react"),
      },
    ]);
  });

  it("reports none when nothing moved", async () => {
    const root = await createWorkspace();
    await snap(root);

    expect(find(await status(root), "ui/button").dependencyUpdates).toEqual([]);
  });
});

describe("several conditions at once", () => {
  it("reports each independently", async () => {
    const root = await createWorkspace();
    await snap(root);
    // Give ui/button a second commit so its anchor has somewhere to lag.
    await writeFile(path.join(root, "components/ui/button/index.ts"), "export const id = 2;\n");
    await snap(root);
    await rewindAnchor(root, "ui/button");
    // Move the dependency on without recording ui/button against it.
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    await snap(root, ["lib/math"]);

    const button = find(await status(root), "ui/button");

    expect(button.behind).toBe(true);
    expect(button.modified).toBe(true);
    expect(button.dependencyUpdates.length).toBeGreaterThan(0);
    expect(button.clean).toBe(false);
  });
});

describe("selection", () => {
  it("reports every registered component with no filter", async () => {
    const root = await createWorkspace();
    await snap(root);

    expect((await status(root)).components.map((item) => item.componentId).sort()).toEqual([
      "envs/react",
      "lib/math",
      "ui/button",
    ]);
  });

  it("fails when a filter matches nothing", async () => {
    const root = await createWorkspace();

    await expect(status(root, ["ui/absent"])).rejects.toThrow(/did not match any components/);
  });

  it("reports rather than fails when a prerequisite outside the selection is unrecorded", async () => {
    const root = await createWorkspace();
    await snap(root, ["envs/react"]);

    // Recording ui/button alone is refused outright in this exact state.
    await expect(snap(root, ["ui/button"])).rejects.toThrow(/has never been snapped/);

    const report = await status(root, ["ui/button"]);
    expect(find(report, "ui/button").neverRecorded).toBe(true);
  });

  it("reports rather than fails when a prerequisite outside the selection is modified", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 2;\n");

    await expect(snap(root, ["ui/button"])).rejects.toThrow(/has uncommitted changes/);

    const button = find(await status(root, ["ui/button"]), "ui/button");
    expect(button.modified).toBe(true);
    expect(button.modifiedBy).toEqual(["lib/math"]);
  });
});

describe("output", () => {
  it("prints one line per component plus detail", async () => {
    const root = await createWorkspace();
    await snap(root);

    const lines = await humanOutput(root);

    expect(lines.filter((line) => !line.startsWith("  "))).toHaveLength(3);
  });

  it("abbreviates versions for reading but never in structured output", async () => {
    const root = await createWorkspace();
    const report = await snap(root);
    const full = report.versionsByComponentId.get("lib/math")!;

    const lines = await humanOutput(root, ["lib/math"]);

    expect(lines[0]).not.toContain(full);
    expect(find(await status(root, ["lib/math"]), "lib/math").headVersion).toBe(full);
  });
});

describe("detail", () => {
  it("reports the same components and conditions as the summary view", async () => {
    const root = await createWorkspace();
    await snap(root);
    await write(root, "components/lib/math/index.ts", "export const add = 1;\n");

    const summary = await status(root);
    const detailed = await detailedStatus(root);

    expect(detailed.components.map((component) => component.componentId)).toEqual(
      summary.components.map((component) => component.componentId)
    );
    for (const component of summary.components) {
      const expanded = find(detailed, component.componentId);
      expect(expanded.modified).toBe(component.modified);
      expect(expanded.clean).toBe(component.clean);
      expect(expanded.behind).toBe(component.behind);
      expect(expanded.neverRecorded).toBe(component.neverRecorded);
      expect(expanded.neverReleased).toBe(component.neverReleased);
    }
  });

  it("expands a modified component into the files that differ", async () => {
    const root = await createWorkspace();
    await snap(root);
    await write(root, "components/lib/math/index.ts", "export const add = 1;\n");
    await write(root, "components/lib/math/extra.ts", "export const extra = 1;\n");

    const detail = find(await detailedStatus(root, ["lib/math"]), "lib/math").detail;

    expect(detail?.files).toEqual([
      { path: "extra.ts", status: "added" },
      { path: "index.ts", status: "modified" },
    ]);
  });

  it("never lists `.comp.json` as a file, reporting metadata changes instead", async () => {
    const root = await createWorkspace();
    await snap(root);
    await write(
      root,
      "components/lib/math/.comp.json",
      JSON.stringify({ dependencies: { clsx: "^2.1.0" } })
    );

    const detail = find(await detailedStatus(root, ["lib/math"]), "lib/math").detail;

    expect(detail?.files).toEqual([]);
    expect(detail?.dependencies).toEqual([
      {
        field: "dependencies",
        packageName: "clsx",
        before: undefined,
        after: "^2.1.0",
        status: "added",
      },
    ]);
  });

  it("expands a component modified only by a prerequisite into no files of its own", async () => {
    const root = await createWorkspace();
    await snap(root);
    await write(root, "components/lib/math/index.ts", "export const add = 1;\n");

    const button = find(await detailedStatus(root), "ui/button");

    expect(button.modified).toBe(true);
    expect(button.modifiedBy).toEqual(["lib/math"]);
    expect(button.detail?.files).toEqual([]);
    expect(button.detail?.dependencies).toEqual([]);
  });

  it("leaves a clean component without an expansion", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root);

    const report = await detailedStatus(root);

    for (const component of report.components) {
      expect(component.clean).toBe(true);
      expect(component.detail).toBeUndefined();
    }
  });

  it("shows the expanded files in the human-readable output", async () => {
    const root = await createWorkspace();
    await snap(root);
    await write(root, "components/lib/math/index.ts", "export const add = 1;\n");

    const output = (await detailedOutput(root, ["lib/math"])).join("\n");

    expect(output).toContain("M  index.ts");
    expect((await humanOutput(root, ["lib/math"])).join("\n")).not.toContain("M  index.ts");
  });
});

describe("independence from installed packages", () => {
  it("reports without any node_modules in the workspace", async () => {
    const root = await createWorkspace();
    await snap(root);

    // The fixture never installs anything; asserting it explicitly keeps a
    // future env-resolving refactor from silently adding the dependency.
    await expect(readFile(path.join(root, "node_modules"))).rejects.toThrow();
    expect((await status(root)).components).toHaveLength(3);
  });
});

async function status(root: string, filters: string[] = []): Promise<StatusReport> {
  return runStatusCommand(parsed(root, filters), { reporter: silent });
}

async function detailedStatus(root: string, filters: string[] = []): Promise<StatusReport> {
  return runStatusCommand(parsed(root, filters, { detail: true }), { reporter: silent });
}

async function humanOutput(root: string, filters: string[] = []): Promise<string[]> {
  const lines: string[] = [];
  await runStatusCommand(parsed(root, filters), {
    reporter: createStatusReporter((message) => lines.push(message)),
  });
  return lines;
}

async function detailedOutput(root: string, filters: string[] = []): Promise<string[]> {
  const lines: string[] = [];
  await runStatusCommand(parsed(root, filters, { detail: true }), {
    reporter: createStatusReporter((message) => lines.push(message)),
  });
  return lines;
}

async function snap(root: string, filters: string[] = []): Promise<SnapReport> {
  return runSnapCommand(parsed(root, filters), { reporter: silent });
}

async function tag(root: string, filters: string[] = []): Promise<void> {
  await runTagCommand(parsed(root, filters), { reporter: silent });
}

type ConfigEntry = {
  path: string;
  id: string;
  packageName: string;
  env: { packageName: string; version: string };
  version?: string;
};

async function readConfig(root: string): Promise<{ components: ConfigEntry[] }> {
  return JSON.parse(await readFile(path.join(root, "bit-lite.json"), "utf8")) as {
    components: ConfigEntry[];
  };
}

async function readAnchor(root: string, componentId: string): Promise<string | undefined> {
  return (await readConfig(root)).components.find((item) => item.id === componentId)?.version;
}

async function setAnchor(root: string, componentId: string, version: string): Promise<void> {
  const config = await readConfig(root);
  const entry = config.components.find((item) => item.id === componentId);
  if (entry === undefined) throw new Error(`no component "${componentId}"`);
  entry.version = version;
  await writeFile(path.join(root, "bit-lite.json"), JSON.stringify(config, null, 2));
}

/**
 * Reproduces the shape sync leaves behind: the head has advanced past the
 * version the workspace still claims to be based on.
 */
async function rewindAnchor(root: string, componentId: string): Promise<void> {
  const store = await openComponentHistoryStore({ workspaceRoot: root, create: false });
  const result = await store.run({
    args: ["rev-parse", `${componentHeadRef(componentId)}^`],
  });
  await setAnchor(root, componentId, `0.0.0-g${result.stdout.toString("utf8").trim()}`);
}


function parsed(
  workspaceRoot: string,
  componentFilters: string[] = [],
  options: Record<string, boolean> = {}
): ParsedCliArgs {
  return {
    command: "status",
    workspaceRoot,
    componentFilters,
    help: { kind: "none" },
    consumedBareWords: [],
    args: {
      raw: [
        "status",
        ...componentFilters.flatMap((filter) => ["--filter", filter]),
        ...Object.keys(options).map((name) => `--${name}`),
      ],
      options: {
        ...(componentFilters.length > 0 ? { filter: componentFilters } : {}),
        ...options,
      },
      passthrough: [],
    },
  };
}

/** lib/math -> nothing; ui/button -> lib/math and the local env envs/react. */
async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-status-"));
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

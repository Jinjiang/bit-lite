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

async function humanOutput(root: string, filters: string[] = []): Promise<string[]> {
  const lines: string[] = [];
  await runStatusCommand(parsed(root, filters), {
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


function parsed(workspaceRoot: string, componentFilters: string[] = []): ParsedCliArgs {
  return {
    command: "status",
    workspaceRoot,
    componentFilters,
    help: false,
    args: {
      raw: ["status", ...componentFilters.flatMap((filter) => ["--filter", filter])],
      options: componentFilters.length > 0 ? { filter: componentFilters } : {},
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

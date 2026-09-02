import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ParsedCliArgs } from "bit-lite-context";
import {
  isSnapVersion,
  openComponentHistoryStore,
  parseSnapVersion,
  readComponentHead,
} from "bit-lite-history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapCommand, type SnapReport } from "./snap.js";

// Real Git subprocesses against real repositories.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const temporaryRoots: string[] = [];
const silent = { report() {} };

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("dependency-ordered recording", () => {
  it("records a dependency before its dependent and names the version just assigned", async () => {
    const root = await createWorkspace();

    const report = await snap(root);

    const mathVersion = report.versionsByComponentId.get("lib/math")!;
    expect(isSnapVersion(mathVersion)).toBe(true);
    expect(await recordedConfig(root, "ui/button")).toMatchObject({
      dependencies: { "@my-scope/lib.math": mathVersion },
    });
  });

  it("records the env component before the components that select it", async () => {
    const root = await createWorkspace();

    const report = await snap(root);

    const envVersion = report.versionsByComponentId.get("envs/react")!;
    expect(await recordedConfig(root, "ui/button")).toMatchObject({
      env: { packageName: "@my-scope/env.react", version: envVersion },
    });
  });

  it("records an external env as the specifier bit-lite.json declares", async () => {
    const root = await createWorkspace();

    await snap(root);

    expect(await recordedConfig(root, "lib/math")).toMatchObject({
      env: { packageName: "demo-env-node", version: "0.0.0" },
    });
  });

  it("never records a workspace placeholder", async () => {
    const root = await createWorkspace();

    await snap(root);

    for (const id of ["lib/math", "ui/button", "envs/react"]) {
      expect(JSON.stringify(await recordedConfig(root, id))).not.toContain("workspace:");
    }
  });

  it("leaves the working component files untouched", async () => {
    const root = await createWorkspace();
    const configPath = path.join(root, "components/ui/button/.comp.json");
    const before = await readFile(configPath, "utf8");

    await snap(root);

    expect(await readFile(configPath, "utf8")).toBe(before);
  });

  it("gives a dependent a new version when only its dependency changed", async () => {
    const root = await createWorkspace();
    const first = await snap(root);

    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 1;\n");
    const second = await snap(root);

    expect(second.versionsByComponentId.get("lib/math")).not.toBe(
      first.versionsByComponentId.get("lib/math")
    );
    // ui/button's own files never changed, but what it was built against did.
    expect(second.changed.map((item) => item.componentId).sort()).toEqual([
      "lib/math",
      "ui/button",
    ]);
    expect(second.versionsByComponentId.get("ui/button")).not.toBe(
      first.versionsByComponentId.get("ui/button")
    );
  });

  it("reports every component unchanged when nothing moved", async () => {
    const root = await createWorkspace();
    const first = await snap(root);

    const second = await snap(root);

    expect(second.changed).toEqual([]);
    expect(second.unchanged).toHaveLength(3);
    expect(second.versionsByComponentId).toEqual(first.versionsByComponentId);
  });

  it("writes version anchors into bit-lite.json without touching other fields", async () => {
    const root = await createWorkspace();

    const report = await snap(root);

    const config = await readConfig(root);
    for (const entry of config.components) {
      expect(entry.version).toBe(report.versionsByComponentId.get(entry.id));
      expect(entry.packageName).toBeDefined();
      expect(entry.env).toBeDefined();
    }
    // The anchor names the commit the component's ref now points at.
    const store = await openComponentHistoryStore({ workspaceRoot: root, create: false });
    const head = await readComponentHead(store, "lib/math");
    expect(parseSnapVersion(report.versionsByComponentId.get("lib/math")!)?.hex).toBe(head?.hex);
  });

  it("keeps anchors out of every recorded tree", async () => {
    const root = await createWorkspace();

    await snap(root);
    await snap(root);

    // A second run must still report unchanged: an anchor inside the tree would
    // feed its own commit hash and defeat content-aware recording.
    const third = await snap(root);
    expect(third.changed).toEqual([]);
    for (const id of ["lib/math", "ui/button"]) {
      expect(await recordedConfig(root, id)).not.toHaveProperty("version");
    }
  });
});

describe("recording strictness", () => {
  it("refuses a selection whose dependency has never been recorded", async () => {
    const root = await createWorkspace();
    // Record the env so the unrecorded dependency is the only thing missing.
    await snap(root, ["envs/react"]);

    await expect(snap(root, ["ui/button"])).rejects.toThrow(
      /component "lib\/math", which "ui\/button" depends on, has never been snapped/
    );
  });

  it("refuses a selection whose env has never been recorded", async () => {
    const root = await createWorkspace();

    await expect(snap(root, ["ui/button"])).rejects.toThrow(
      /component "envs\/react", which "ui\/button" depends on, has never been snapped/
    );
  });

  it("names the filter that would fix an unrecorded dependency", async () => {
    const root = await createWorkspace();
    await snap(root, ["envs/react"]);

    await expect(snap(root, ["ui/button"])).rejects.toThrow(
      "--filter ui/button --filter lib/math"
    );
  });

  it("refuses a selection whose dependency has uncommitted changes", async () => {
    const root = await createWorkspace();
    await snap(root);
    await writeFile(path.join(root, "components/lib/math/index.ts"), "export const add = 2;\n");

    await expect(snap(root, ["ui/button"])).rejects.toThrow(
      /component "lib\/math", which "ui\/button" depends on, has uncommitted changes/
    );
  });

  it("advances no ref and writes no anchor when strictness fails", async () => {
    const root = await createWorkspace();
    const before = await readFile(path.join(root, "bit-lite.json"), "utf8");

    await expect(snap(root, ["ui/button"])).rejects.toThrow();

    expect(await readFile(path.join(root, "bit-lite.json"), "utf8")).toBe(before);
    const store = await openComponentHistoryStore({ workspaceRoot: root });
    expect(await readComponentHead(store, "ui/button")).toBeUndefined();
    expect(await readComponentHead(store, "lib/math")).toBeUndefined();
  });

  it("resolves an unchanged dependency outside the selection without recording it", async () => {
    const root = await createWorkspace();
    const first = await snap(root);
    await writeFile(
      path.join(root, "components/ui/button/index.ts"),
      "export const id = 'changed';\n"
    );

    const second = await snap(root, ["ui/button"]);

    expect(second.components.map((item) => item.componentId)).toEqual(["ui/button"]);
    expect(second.versionsByComponentId.has("lib/math")).toBe(false);
    // lib/math keeps the version it already had, and its ref did not move.
    expect((await readConfig(root)).components.find((item) => item.id === "lib/math")?.version)
      .toBe(first.versionsByComponentId.get("lib/math"));
    expect(await recordedConfig(root, "ui/button")).toMatchObject({
      dependencies: { "@my-scope/lib.math": first.versionsByComponentId.get("lib/math") },
    });
  });

  it("rejects a component registered at the workspace root", async () => {
    const root = await createWorkspace();
    const config = await readConfig(root);
    config.components.push({
      path: ".",
      id: "whole/workspace",
      packageName: "@my-scope/whole",
      env: { packageName: "demo-env-node", version: "0.0.0" },
    });
    await writeFile(path.join(root, "bit-lite.json"), JSON.stringify(config, null, 2));

    await expect(snap(root)).rejects.toThrow(
      'component "whole/workspace" path must not be the workspace root'
    );
  });
});

type ConfigEntry = {
  path: string;
  id: string;
  packageName: string;
  env: { packageName: string; version: string };
  version?: string;
};

async function snap(root: string, filters: string[] = []): Promise<SnapReport> {
  return runSnapCommand(parsed(root, filters), { reporter: silent });
}

async function readConfig(root: string): Promise<{ components: ConfigEntry[] }> {
  return JSON.parse(await readFile(path.join(root, "bit-lite.json"), "utf8")) as {
    components: ConfigEntry[];
  };
}

/** Reads the `.comp.json` a component's current snap actually recorded. */
async function recordedConfig(root: string, componentId: string): Promise<Record<string, unknown>> {
  const store = await openComponentHistoryStore({ workspaceRoot: root, create: false });
  const head = await readComponentHead(store, componentId);
  if (head === undefined) throw new Error(`component "${componentId}" has no snap`);
  const blob = await store.run({ args: ["cat-file", "blob", `${head.hex}:.comp.json`] });
  return JSON.parse(blob.stdout.toString("utf8")) as Record<string, unknown>;
}

function parsed(workspaceRoot: string, componentFilters: string[] = []): ParsedCliArgs {
  return {
    command: "snap",
    workspaceRoot,
    componentFilters,
    help: false,
    args: {
      raw: ["snap", ...componentFilters.flatMap((filter) => ["--filter", filter])],
      options: componentFilters.length > 0 ? { filter: componentFilters } : {},
      passthrough: [],
    },
  };
}

/**
 * lib/math -> (nothing), ui/button -> lib/math and the local env envs/react,
 * so one workspace exercises both edge kinds.
 */
async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-snap-order-"));
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

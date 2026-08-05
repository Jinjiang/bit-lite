import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ install: vi.fn() }));

vi.mock("./pnpm-engine.js", () => ({
  installWithPnpmEngine: mocks.install,
  getPnpmEngineVersion: () => "12.0.0-beta.4",
}));

import { installDependencyProjects, type DependencyInstallProgressEvent } from "./index.js";

let ROOT: string;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.install.mockResolvedValue({ stats: { added: 0, removed: 0, linkedToRoot: 0 }, storeDir: "/store" });
  ROOT = await mkdtemp(path.join(tmpdir(), "bit-lite-deps-"));
});

afterEach(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

function project(rootDir: string, name: string, dependencies?: Record<string, string>) {
  return {
    rootDir,
    manifest: { name, version: "0.0.0", ...(dependencies ? { dependencies } : {}) },
  };
}

function installOptions() {
  return mocks.install.mock.calls[0]![0];
}

describe("engine install options", () => {
  it("anchors the install root so the engine cannot adopt an enclosing workspace", async () => {
    await installDependencyProjects({ rootDir: ROOT, projects: [project(ROOT, "generated-root")] });

    // Without this file the engine walks up and prunes the enclosing
    // repository's node_modules.
    expect(await readFile(path.join(ROOT, "pnpm-workspace.yaml"), "utf8")).toBe("packages: []\n");
  });

  it("installs only bit-lite's own projects", async () => {
    await installDependencyProjects({
      rootDir: ROOT,
      projects: [
        project(ROOT, "generated-root"),
        project(`${ROOT}/components/@my-scope/ui.button`, "@my-scope/ui.button", { "demo-utils": "1.0.0" }),
      ],
      workspacePackages: [project("/workspace/../demo-utils", "demo-utils")],
    });

    const options = installOptions();
    expect(options.dir).toBe(ROOT);
    // The local package is linked, never installed.
    expect(options.projects.map((p: { rootDir: string }) => p.rootDir)).toEqual([
      ROOT,
      `${ROOT}/components/@my-scope/ui.button`,
    ]);
  });

  it("links local packages that a project depends on, relative to the install root", async () => {
    await installDependencyProjects({
      rootDir: ROOT,
      projects: [project(ROOT, "generated-root", { "demo-utils": "1.0.0" })],
      workspacePackages: [
        project(path.join(ROOT, "..", "..", "packages", "demo-utils"), "demo-utils"),
      ],
    });

    expect(installOptions().overrides).toEqual({
      "demo-utils": "link:../../packages/demo-utils",
    });
    expect(installOptions().linkWorkspacePackages).toBe(true);
  });

  it("ignores local packages no project depends on", async () => {
    await installDependencyProjects({
      rootDir: ROOT,
      projects: [project(ROOT, "generated-root", { react: "19.0.0" })],
      workspacePackages: [
        project("/workspace/packages/demo-utils", "demo-utils"),
        project("/workspace/packages/demo-config", "demo-config"),
      ],
    });

    const options = installOptions();
    expect(options.overrides).toBeUndefined();
    expect(options.linkWorkspacePackages).toBe(false);
  });

  it("collects dependency names from every manifest field", async () => {
    await installDependencyProjects({
      rootDir: ROOT,
      projects: [
        { rootDir: ROOT, manifest: { name: "generated-root", version: "0.0.0" } },
        {
          rootDir: `${ROOT}/components/a`,
          manifest: { name: "a", version: "0.0.0", devDependencies: { "demo-config": "1.0.0" } },
        },
        {
          rootDir: `${ROOT}/components/b`,
          manifest: { name: "b", version: "0.0.0", peerDependencies: { "demo-vendors": "1.0.0" } },
        },
      ],
      workspacePackages: [
        project("/workspace/packages/demo-config", "demo-config"),
        project("/workspace/packages/demo-vendors", "demo-vendors"),
      ],
    });

    expect(Object.keys(installOptions().overrides).sort()).toEqual(["demo-config", "demo-vendors"]);
  });

  it("preserves the install settings bit-lite depends on", async () => {
    await installDependencyProjects({ rootDir: ROOT, projects: [project(ROOT, "generated-root")] });

    expect(installOptions()).toMatchObject({
      autoInstallPeers: false,
      dedupeDirectDeps: true,
      dedupePeerDependents: true,
      depth: 0,
      enableModulesDir: true,
      hoistPattern: [],
      ignoreScripts: true,
      includeOptionalDeps: true,
      injectWorkspacePackages: false,
      nodeLinker: "isolated",
      frozenLockfile: false,
      preferFrozenLockfile: true,
      resolvePeersFromWorkspaceRoot: false,
    });
  });
});

describe("progress reporting", () => {
  it("converts engine log records into progress events", async () => {
    const events: DependencyInstallProgressEvent[] = [];
    mocks.install.mockImplementation(async (_options: unknown, onLog?: (record: unknown) => void) => {
      onLog?.({ name: "pnpm:stage", prefix: ROOT, stage: "resolution_started" });
      onLog?.({ name: "pnpm:progress", requester: ROOT, status: "fetched", packageId: "react@19.0.0" });
      onLog?.({ name: "pnpm:stats", prefix: ROOT, added: 3 });
      return { stats: { added: 3, removed: 0, linkedToRoot: 0 }, storeDir: "/store" };
    });

    await installDependencyProjects({
      rootDir: ROOT,
      projects: [project(ROOT, "generated-root")],
      onProgress: (event) => events.push(event),
    });

    expect(events).toEqual([
      { type: "stage", stage: "resolution", status: "started" },
      { type: "progress", counts: { resolved: 0, reused: 0, downloaded: 1, added: 0 } },
      { type: "stats", added: 3, removed: 0 },
    ]);
  });

  it("does not attach a listener when progress is not requested", async () => {
    await installDependencyProjects({ rootDir: ROOT, projects: [project(ROOT, "generated-root")] });

    expect(mocks.install.mock.calls[0]![1]).toBeUndefined();
  });

  it("propagates engine failures", async () => {
    const failure = new Error("Failed to resolve dependency tree");
    mocks.install.mockRejectedValue(failure);

    await expect(
      installDependencyProjects({ rootDir: ROOT, projects: [project(ROOT, "generated-root")] })
    ).rejects.toBe(failure);
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";

const mocks = vi.hoisted(() => ({
  runPnpmInstall: vi.fn(),
}));

vi.mock("./pnpm-cli.js", () => ({ runPnpmInstall: mocks.runPnpmInstall }));

import { installDependencyProjects, type DependencyInstallProgressEvent } from "./index.js";

let rootDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.runPnpmInstall.mockResolvedValue(undefined);
  rootDir = await mkdtemp(path.join(tmpdir(), "bit-lite-deps-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

async function readGeneratedWorkspace() {
  return parseYaml(await readFile(path.join(rootDir, "pnpm-workspace.yaml"), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("generated install workspace", () => {
  it("lists component projects and local packages relative to the install root", async () => {
    await installDependencyProjects({
      rootDir,
      projects: [
        { rootDir, manifest: { name: "generated-root", version: "0.0.0" } },
        {
          rootDir: path.join(rootDir, "components", "@my-scope", "ui.button"),
          manifest: { name: "@my-scope/ui.button", version: "0.0.0" },
        },
      ],
      workspacePackages: [
        {
          rootDir: path.join(rootDir, "..", "..", "demo-utils"),
          manifest: { name: "demo-utils", version: "1.0.0" },
        },
      ],
    });

    const workspace = await readGeneratedWorkspace();

    // The install root is a project implicitly, so it is not listed again.
    expect(workspace.packages).toEqual([
      "../../demo-utils",
      "components/@my-scope/ui.button",
    ]);
  });

  it("installs only its own projects so enclosing repositories stay untouched", async () => {
    const componentDir = path.join(rootDir, "components", "@my-scope", "ui.button");
    const localPackageDir = path.join(rootDir, "..", "..", "demo-utils");

    await installDependencyProjects({
      rootDir,
      projects: [
        { rootDir, manifest: { name: "generated-root", version: "0.0.0" } },
        { rootDir: componentDir, manifest: { name: "@my-scope/ui.button", version: "0.0.0" } },
      ],
      workspacePackages: [
        { rootDir: localPackageDir, manifest: { name: "demo-utils", version: "1.0.0" } },
      ],
    });

    const workspace = await readGeneratedWorkspace();
    // The local package is a workspace member, so it can be linked...
    expect(workspace.packages).toContain("../../demo-utils");
    // ...but it is never an install target.
    expect(mocks.runPnpmInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [".", "./components/@my-scope/ui.button"],
      })
    );
  });

  it("enables workspace linking only when local packages are available", async () => {
    await installDependencyProjects({
      rootDir,
      projects: [{ rootDir, manifest: { name: "generated-root", version: "0.0.0" } }],
    });

    const withoutLocals = await readGeneratedWorkspace();
    expect(withoutLocals).toMatchObject({
      packages: [],
      linkWorkspacePackages: false,
      preferWorkspacePackages: false,
    });

    await installDependencyProjects({
      rootDir,
      projects: [{ rootDir, manifest: { name: "generated-root", version: "0.0.0" } }],
      workspacePackages: [
        { rootDir: path.join(rootDir, "local"), manifest: { name: "local", version: "1.0.0" } },
      ],
    });

    const withLocals = await readGeneratedWorkspace();
    expect(withLocals).toMatchObject({
      linkWorkspacePackages: true,
      preferWorkspacePackages: true,
    });
  });

  it("preserves the install settings bit-lite depends on", async () => {
    await installDependencyProjects({
      rootDir,
      projects: [{ rootDir, manifest: { name: "generated-root", version: "0.0.0" } }],
    });

    expect(await readGeneratedWorkspace()).toMatchObject({
      autoInstallPeers: false,
      confirmModulesPurge: false,
      dedupeDirectDeps: true,
      dedupePeerDependents: true,
      excludeLinksFromLockfile: true,
      hoist: false,
      ignoreScripts: true,
      injectWorkspacePackages: false,
      nodeLinker: "isolated",
      resolutionMode: "highest",
      resolvePeersFromWorkspaceRoot: false,
      strictPeerDependencies: false,
    });
  });
});

describe("installDependencyProjects progress lifecycle", () => {
  it("streams reporter output into progress events", async () => {
    const events: DependencyInstallProgressEvent[] = [];
    mocks.runPnpmInstall.mockImplementation(
      async (options: { onOutput?: (chunk: string) => void }) => {
        options.onOutput?.(
          `${JSON.stringify({ name: "pnpm:stage", prefix: rootDir, stage: "resolution_started" })}\n`
        );
        // A record split across chunks must still be parsed once complete.
        options.onOutput?.(`${JSON.stringify({ name: "pnpm:stats", prefix: rootDir, added: 3 })}`);
      }
    );

    await installDependencyProjects({
      rootDir,
      projects: [{ rootDir, manifest: { name: "generated-root", version: "0.0.0" } }],
      onProgress: (event) => events.push(event),
    });

    expect(events).toEqual([
      { type: "stage", stage: "resolution", status: "started" },
      { type: "stats", added: 3, removed: 0 },
    ]);
  });

  it("does not stream output when progress is not requested", async () => {
    await installDependencyProjects({
      rootDir,
      projects: [{ rootDir, manifest: { name: "generated-root", version: "0.0.0" } }],
    });

    expect(mocks.runPnpmInstall).toHaveBeenCalledWith({ cwd: rootDir, filters: ["."] });
  });

  it("propagates install failures after flushing pending progress", async () => {
    const events: DependencyInstallProgressEvent[] = [];
    const failure = new Error("pnpm install failed with exit code 1");
    mocks.runPnpmInstall.mockImplementation(
      async (options: { onOutput?: (chunk: string) => void }) => {
        options.onOutput?.(JSON.stringify({ name: "pnpm:stats", prefix: rootDir, added: 2 }));
        throw failure;
      }
    );

    await expect(
      installDependencyProjects({
        rootDir,
        projects: [{ rootDir, manifest: { name: "generated-root", version: "0.0.0" } }],
        onProgress: (event) => events.push(event),
      })
    ).rejects.toBe(failure);

    expect(events).toEqual([{ type: "stats", added: 2, removed: 0 }]);
  });
});

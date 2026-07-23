import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedCliArgs, WorkspaceComponent } from "bit-lite-context";
import type { DependencyInstallProgressEvent } from "bit-lite-deps";
import type { InstallReporter, InstallProgressStream } from "./install-reporter.js";

const mocks = vi.hoisted(() => ({
  readWorkspace: vi.fn(),
  discoverWorkspacePackages: vi.fn(),
  installDependencies: vi.fn(),
  linkComponents: vi.fn(),
  compileComponents: vi.fn(),
}));

vi.mock("bit-lite-context", async (importOriginal) => {
  const original = await importOriginal<typeof import("bit-lite-context")>();
  return { ...original, readWorkspace: mocks.readWorkspace };
});
vi.mock("bit-lite-deps", () => ({
  discoverPnpmWorkspacePackages: mocks.discoverWorkspacePackages,
  installDependencyProjects: mocks.installDependencies,
}));
vi.mock("./compile.js", () => ({
  compileComponentPackages: mocks.compileComponents,
}));
vi.mock("./link.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./link.js")>();
  return { ...original, linkComponentPackages: mocks.linkComponents };
});

import {
  createComponentDependencyManifest,
  runInstallCommand,
} from "./install.js";
import { createInstallReporter } from "./install-reporter.js";

const temporaryRoots: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  mocks.discoverWorkspacePackages.mockResolvedValue([]);
  mocks.installDependencies.mockResolvedValue(undefined);
  mocks.linkComponents.mockResolvedValue(undefined);
  mocks.compileComponents.mockResolvedValue([]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("component dependency manifests", () => {
  it("derives external envs as development dependencies", () => {
    const manifest = createComponentDependencyManifest(component({
      env: { packageName: "@scope/env.node", version: "^1.2.0" },
      devDependencies: { vitest: "^4.0.0" },
    }));
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toEqual({
      "@scope/env.node": "^1.2.0",
      vitest: "^4.0.0",
    });
  });

  it("keeps local env tooling out of dependency manifests", () => {
    const manifest = createComponentDependencyManifest(component({
      env: { packageName: "@scope/env.local", version: "workspace:*" },
      internalEnvPackageName: "@scope/env.local",
    }));
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
  });

  it("emits a dual-role inherited parent once as a runtime dependency", () => {
    const manifest = createComponentDependencyManifest(component({
      env: { packageName: "@scope/env.node", version: "1.0.0" },
      dependencies: { "@scope/env.node": "1.0.0" },
      devDependencies: { "@scope/env.node": "1.0.0" },
    }));
    expect(manifest.dependencies).toEqual({ "@scope/env.node": "1.0.0" });
    expect(manifest.devDependencies).toBeUndefined();
  });
});

describe("install command progress", () => {
  it("reports ordered phases without compilation and preserves stdout summaries", async () => {
    const fixture = await installFixture();
    const progress = recorder();
    mocks.readWorkspace.mockResolvedValue(fixture.workspace);
    mocks.installDependencies.mockImplementation(async (options) => {
      const onProgress = options.onProgress as (event: DependencyInstallProgressEvent) => void;
      onProgress({ type: "stage", stage: "resolution", status: "started" });
      onProgress({
        type: "progress",
        counts: { resolved: 3, reused: 2, downloaded: 1, added: 3 },
      });
    });

    await runInstallCommand(parsed(fixture.root), { reporter: progress.reporter });

    expect(progress.calls).toEqual([
      "start:Reading workspace",
      "succeed:Found 2 component packages",
      "start:Preparing dependencies for 2 component packages",
      "update:Installing dependencies",
      "dependency:stage",
      "dependency:progress",
      "succeed:Installed dependencies for 2 component packages",
      "start:Linking 2 component packages",
      "succeed:Linked 2 component packages",
      "close",
    ]);
    expect(mocks.compileComponents).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenNthCalledWith(
      1,
      "Installed 3 external dependency requirements across 2 component packages."
    );
    expect(console.log).toHaveBeenNthCalledWith(2, "Linked 2 component packages.");
  });

  it("reports compilation after linking and retains compiled package output", async () => {
    const fixture = await installFixture();
    const progress = recorder();
    mocks.readWorkspace.mockResolvedValue(fixture.workspace);
    mocks.compileComponents.mockResolvedValue(fixture.workspace.components);

    await runInstallCommand(parsed(fixture.root, true), { reporter: progress.reporter });

    expect(progress.calls.slice(-3)).toEqual([
      "start:Compiling 2 component packages",
      "succeed:Compiled 2 component packages",
      "close",
    ]);
    expect(
      progress.calls.indexOf("start:Compiling 2 component packages")
    ).toBeGreaterThan(progress.calls.indexOf("succeed:Linked 2 component packages"));
    expect(console.log).toHaveBeenCalledWith("Compiled 2 component packages.");
    expect(console.log).toHaveBeenCalledWith("- @scope/lib.a");
    expect(console.log).toHaveBeenCalledWith("- @scope/lib.b");
  });

  it("marks dependency failure, preserves the error, and stops later work", async () => {
    const fixture = await installFixture();
    const progress = recorder();
    const failure = new Error("registry unavailable");
    mocks.readWorkspace.mockResolvedValue(fixture.workspace);
    mocks.installDependencies.mockRejectedValue(failure);

    await expect(
      runInstallCommand(parsed(fixture.root), { reporter: progress.reporter })
    ).rejects.toBe(failure);

    expect(progress.calls).toContain("fail:Dependency installation failed");
    expect(progress.calls.at(-1)).toBe("close");
    expect(mocks.linkComponents).not.toHaveBeenCalled();
    expect(mocks.compileComponents).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("marks compilation failure without replacing existing details", async () => {
    const fixture = await installFixture();
    const progress = recorder();
    const failure = new Error("compiler diagnostic");
    mocks.readWorkspace.mockResolvedValue(fixture.workspace);
    mocks.compileComponents.mockRejectedValue(failure);

    await expect(
      runInstallCommand(parsed(fixture.root, true), { reporter: progress.reporter })
    ).rejects.toBe(failure);

    expect(progress.calls).toContain("fail:Component compilation failed");
    expect(progress.calls.at(-1)).toBe("close");
    expect(console.log).toHaveBeenCalledWith(
      "Installed 3 external dependency requirements across 2 component packages."
    );
    expect(console.log).toHaveBeenCalledWith("Linked 2 component packages.");
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("Compiled"));
  });

  it("marks workspace failure and always closes the reporter", async () => {
    const progress = recorder();
    const failure = new Error("invalid workspace");
    mocks.readWorkspace.mockRejectedValue(failure);

    await expect(
      runInstallCommand(parsed("/workspace"), { reporter: progress.reporter })
    ).rejects.toBe(failure);

    expect(progress.calls).toEqual([
      "start:Reading workspace",
      "fail:Workspace discovery failed",
      "close",
    ]);
  });

  it("keeps non-interactive progress on its stream and summaries on stdout", async () => {
    const fixture = await installFixture();
    const stream = new MemoryStream(false);
    mocks.readWorkspace.mockResolvedValue(fixture.workspace);
    mocks.installDependencies.mockImplementation(async (options) => {
      const onProgress = options.onProgress as (event: DependencyInstallProgressEvent) => void;
      onProgress({
        type: "progress",
        counts: { resolved: 3, reused: 3, downloaded: 0, added: 3 },
      });
    });

    await runInstallCommand(parsed(fixture.root), {
      reporter: createInstallReporter({ stream }),
    });

    expect(stream.output).toContain("[install] Reading workspace\n");
    expect(stream.output).toContain("resolved 3, reused 3, downloaded 0, added 3");
    expect(stream.output).not.toContain("Installed 3 external dependency requirements");
    expect(console.log).toHaveBeenCalledWith(
      "Installed 3 external dependency requirements across 2 component packages."
    );
  });
});

function component(overrides: Partial<WorkspaceComponent>): WorkspaceComponent {
  return {
    id: "lib/math",
    path: "components/lib/math",
    rootDir: "/workspace/components/lib/math",
    packageName: "@scope/lib.math",
    kind: "component",
    env: { packageName: "@scope/env.node", version: "1.0.0" },
    mainFile: "/workspace/components/lib/math/index.ts",
    mainFileRelative: "index.ts",
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    internalDependencyPackageNames: [],
    internalEnvPackageName: undefined,
    ...overrides,
  };
}

async function installFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-install-"));
  temporaryRoots.push(root);
  const components = [
    component({
      id: "lib/a",
      path: "components/lib/a",
      rootDir: path.join(root, "components/lib/a"),
      packageName: "@scope/lib.a",
      dependencies: { lodash: "^4.17.21" },
    }),
    component({
      id: "lib/b",
      path: "components/lib/b",
      rootDir: path.join(root, "components/lib/b"),
      packageName: "@scope/lib.b",
      devDependencies: { vitest: "^4.1.8" },
    }),
  ];
  return {
    root,
    workspace: {
      rootDir: root,
      configFile: path.join(root, "bit-lite.json"),
      config: {},
      components,
    },
  };
}

function parsed(workspaceRoot: string, compile = false): ParsedCliArgs {
  return {
    command: "install",
    workspaceRoot,
    componentFilters: [],
    help: false,
    args: {
      raw: compile ? ["install", "--compile"] : ["install"],
      options: compile ? { compile: true } : {},
      passthrough: [],
    },
  };
}

function recorder() {
  const calls: string[] = [];
  const reporter: InstallReporter = {
    start: (message) => calls.push(`start:${message}`),
    update: (message) => calls.push(`update:${message}`),
    dependency: (event) => calls.push(`dependency:${event.type}`),
    diagnostic: (kind, message) => calls.push(`diagnostic:${kind}:${message}`),
    succeed: (message) => calls.push(`succeed:${message}`),
    fail: (message) => calls.push(`fail:${message}`),
    close: () => calls.push("close"),
  };
  return { calls, reporter };
}

class MemoryStream implements InstallProgressStream {
  output = "";

  constructor(readonly isTTY: boolean) {}

  write(value: string) {
    this.output += value;
    return true;
  }
}

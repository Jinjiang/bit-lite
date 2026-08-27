import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ParsedCliArgs } from "bit-lite-context";
import {
  createGitRunner,
  resolveComponentStorePath,
  runGitLine,
} from "bit-lite-history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapCommand, type SnapReport, type SnapReporter } from "./snap.js";

// These tests drive real Git subprocesses against real repositories, which
// exceeds the 5s default when the package suite runs in parallel with the
// preview and start end-to-end tests.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

type ComponentFixture = { id: string; directory: string; packageName: string };

const fixtureComponents: readonly ComponentFixture[] = [
  { id: "lib/math", directory: "components/lib/math", packageName: "@my-scope/lib.math" },
  { id: "ui/button", directory: "components/ui/button", packageName: "@my-scope/ui.button" },
];

async function writeWorkspaceFile(
  root: string,
  relativePath: string,
  contents: string
): Promise<string> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
  return absolutePath;
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-snap-cli-"));
  temporaryRoots.push(root);

  await writeWorkspaceFile(
    root,
    "bit-lite.json",
    JSON.stringify({
      defaultScope: "my-scope",
      components: fixtureComponents.map((component) => ({
        path: component.directory,
        id: component.id,
        packageName: component.packageName,
        env: { packageName: "demo-env-node", version: "0.0.0" },
      })),
    })
  );

  for (const component of fixtureComponents) {
    await writeWorkspaceFile(
      root,
      `${component.directory}/.comp.json`,
      JSON.stringify({ dependencies: {}, devDependencies: {}, peerDependencies: {} })
    );
    await writeWorkspaceFile(
      root,
      `${component.directory}/index.ts`,
      `export const id = "${component.id}";\n`
    );
  }

  return root;
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

function recorder(): { lines: string[]; reporter: SnapReporter } {
  const lines: string[] = [];
  return {
    lines,
    reporter: {
      report(report: SnapReport) {
        for (const component of report.components) {
          lines.push(`${component.status}:${component.componentId}:${component.snapId}`);
        }
      },
    },
  };
}

describe("snap command selection", () => {
  it("selects every registered component without filters", async () => {
    const root = await createWorkspace();
    const report = await runSnapCommand(parsed(root), { reporter: recorder().reporter });

    expect(report.components.map((component) => component.componentId)).toEqual([
      "lib/math",
      "ui/button",
    ]);
    expect(report.changed).toHaveLength(2);
  });

  it("captures only matching components when filters are supplied", async () => {
    const root = await createWorkspace();
    const report = await runSnapCommand(parsed(root, ["ui/**"]), {
      reporter: recorder().reporter,
    });

    expect(report.components.map((component) => component.componentId)).toEqual(["ui/button"]);
  });

  it("accepts repeated filters", async () => {
    const root = await createWorkspace();
    const report = await runSnapCommand(parsed(root, ["ui/button", "lib/math"]), {
      reporter: recorder().reporter,
    });

    expect(report.components).toHaveLength(2);
  });

  it("fails when no registered component matches", async () => {
    const root = await createWorkspace();
    await expect(
      runSnapCommand(parsed(root, ["does/not-exist"]), { reporter: recorder().reporter })
    ).rejects.toThrow(/did not match any components/);
  });
});

describe("snap command reporting", () => {
  it("reports canonical ids and algorithm-qualified snap ids", async () => {
    const root = await createWorkspace();
    const { lines, reporter } = recorder();
    await runSnapCommand(parsed(root), { reporter });

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatch(/^created:[^:]+:(sha1|sha256):[0-9a-f]+$/);
    }
    expect(lines[0]).toContain("lib/math");
  });

  it("separates changed from unchanged components", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsed(root), { reporter: recorder().reporter });

    await writeWorkspaceFile(root, "components/ui/button/index.ts", "export const id = 2;\n");
    const second = await runSnapCommand(parsed(root), { reporter: recorder().reporter });

    expect(second.changed.map((component) => component.componentId)).toEqual(["ui/button"]);
    expect(second.unchanged.map((component) => component.componentId)).toEqual(["lib/math"]);
  });

  it("reports the store path it recorded into", async () => {
    const root = await createWorkspace();
    const report = await runSnapCommand(parsed(root), { reporter: recorder().reporter });

    expect(report.storePath).toBe(resolveComponentStorePath(root));
  });
});

describe("snap command failures", () => {
  it("fails without advancing any ref when a component cannot be captured", async () => {
    const root = await createWorkspace();
    await symlink(
      path.join(root, "components/lib/math/index.ts"),
      path.join(root, "components/ui/button/alias.ts")
    );

    await expect(runSnapCommand(parsed(root), { reporter: recorder().reporter })).rejects.toThrow(
      /symbolic link/
    );

    const store = createGitRunner({ gitDir: resolveComponentStorePath(root) });
    expect(await runGitLine(store, ["for-each-ref", "--format=%(refname)"])).toBe("");
  });

  it("fails with an actionable diagnostic when the workspace config is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-snap-empty-"));
    temporaryRoots.push(root);

    await expect(
      runSnapCommand(parsed(root), { reporter: recorder().reporter })
    ).rejects.toThrow();
  });
});

describe("source repository isolation", () => {
  it("leaves the workspace source repository entirely untouched", async () => {
    const root = await createWorkspace();
    const sourceGit = createGitRunner({ gitDir: path.join(root, ".git") });
    await createGitRunner()({ args: ["init", "--quiet", root] });
    await sourceGit({ args: ["config", "user.email", "fixture@example.com"] });
    await sourceGit({ args: ["config", "user.name", "Fixture"] });
    await sourceGit({ args: ["config", "core.excludesFile", "/dev/null"] });

    const before = {
      refs: await runGitLine(sourceGit, ["for-each-ref", "--format=%(refname) %(objectname)"]),
      status: await runGitLine(sourceGit, ["--work-tree", root, "status", "--porcelain"]),
      config: await runGitLine(sourceGit, ["config", "--local", "--list"]),
      remotes: await runGitLine(sourceGit, ["remote", "-v"]),
    };

    await runSnapCommand(parsed(root), { reporter: recorder().reporter });

    expect(await runGitLine(sourceGit, ["for-each-ref", "--format=%(refname) %(objectname)"])).toBe(
      before.refs
    );
    expect(await runGitLine(sourceGit, ["config", "--local", "--list"])).toBe(before.config);
    expect(await runGitLine(sourceGit, ["remote", "-v"])).toBe(before.remotes);

    // The only new worktree entry is the durable store itself.
    const after = await runGitLine(sourceGit, ["--work-tree", root, "status", "--porcelain"]);
    const newEntries = after
      .split("\n")
      .filter((line) => line.length > 0 && !before.status.includes(line));
    expect(newEntries.every((line) => line.includes(".bit-lite-store.git"))).toBe(true);

    // The source repository never gained an index or any Bit Lite refs.
    const sourceGitEntries = await readdir(path.join(root, ".git"));
    expect(sourceGitEntries).not.toContain("MERGE_HEAD");
    expect(await runGitLine(sourceGit, ["for-each-ref", "refs/heads/components"])).toBe("");
  });

  it("creates the store outside the disposable .bit-lite directory", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsed(root), { reporter: recorder().reporter });

    const entries = await readdir(root);
    expect(entries).toContain(".bit-lite-store.git");
    expect(resolveComponentStorePath(root)).not.toContain(`${path.sep}.bit-lite${path.sep}`);
  });
});

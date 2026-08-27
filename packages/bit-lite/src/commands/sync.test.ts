import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ParsedCliArgs } from "bit-lite-context";
import { createGitRunner, runGitLine, type SyncResult } from "bit-lite-history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapCommand } from "./snap.js";
import { runSyncCommand, type SyncReporter } from "./sync.js";

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

async function createTemporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function createRemote(): Promise<string> {
  const root = await createTemporaryRoot("bit-lite-sync-cli-remote-");
  const remotePath = path.join(root, "components.git");
  await createGitRunner()({ args: ["init", "--bare", "--quiet", remotePath] });
  return remotePath;
}

async function writeWorkspaceFile(
  root: string,
  relativePath: string,
  contents: string
): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

async function createWorkspace(): Promise<string> {
  const root = await createTemporaryRoot("bit-lite-sync-cli-");
  await writeWorkspaceFile(
    root,
    "bit-lite.json",
    JSON.stringify({
      defaultScope: "my-scope",
      components: [
        {
          path: "components/ui/button",
          id: "ui/button",
          packageName: "@my-scope/ui.button",
          env: { packageName: "demo-env-node", version: "0.0.0" },
        },
      ],
    })
  );
  await writeWorkspaceFile(
    root,
    "components/ui/button/.comp.json",
    JSON.stringify({ dependencies: {}, devDependencies: {}, peerDependencies: {} })
  );
  await writeWorkspaceFile(root, "components/ui/button/index.ts", 'export const id = "button";\n');
  return root;
}

function parsedSync(workspaceRoot: string, remote?: string | string[]): ParsedCliArgs {
  return {
    command: "sync",
    workspaceRoot,
    componentFilters: [],
    help: false,
    args: {
      raw: ["sync"],
      options: remote === undefined ? {} : { remote },
      passthrough: [],
    },
  };
}

function parsedSnap(workspaceRoot: string): ParsedCliArgs {
  return {
    command: "snap",
    workspaceRoot,
    componentFilters: [],
    help: false,
    args: { raw: ["snap"], options: {}, passthrough: [] },
  };
}

function recorder(): { results: SyncResult[]; reporter: SyncReporter } {
  const results: SyncResult[] = [];
  return { results, reporter: { report: (result) => results.push(result) } };
}

const silentSnapReporter = { report: () => undefined };

describe("sync command", () => {
  it("publishes local history to a newly configured remote", async () => {
    const root = await createWorkspace();
    const remotePath = await createRemote();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });

    const { results, reporter } = recorder();
    const result = await runSyncCommand(parsedSync(root, remotePath), { reporter });

    expect(result.remoteUrl).toBe(remotePath);
    expect(result.heads).toEqual([
      expect.objectContaining({ componentId: "ui/button", outcome: "published" }),
    ]);
    expect(results).toHaveLength(1);

    const remote = createGitRunner({ gitDir: remotePath });
    expect(await runGitLine(remote, ["for-each-ref", "--format=%(refname)"])).toContain(
      "refs/heads/components/"
    );
  });

  it("reuses the configured remote on later runs", async () => {
    const root = await createWorkspace();
    const remotePath = await createRemote();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });
    await runSyncCommand(parsedSync(root, remotePath), { reporter: recorder().reporter });

    const second = await runSyncCommand(parsedSync(root), { reporter: recorder().reporter });
    expect(second.upToDate).toBe(true);
  });

  it("rejects a repeated --remote", async () => {
    const root = await createWorkspace();
    await expect(
      runSyncCommand(parsedSync(root, ["a", "b"]), { reporter: recorder().reporter })
    ).rejects.toThrow(/exactly one value/);
  });

  it("fails when no remote has ever been configured", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });

    await expect(
      runSyncCommand(parsedSync(root), { reporter: recorder().reporter })
    ).rejects.toThrow(/no component history remote/);
  });

  it("reports every conflict before failing", async () => {
    const root = await createWorkspace();
    const remotePath = await createRemote();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });
    await runSyncCommand(parsedSync(root, remotePath), { reporter: recorder().reporter });

    // A second workspace publishes a competing history for the same component.
    const other = await createWorkspace();
    await runSyncCommand(parsedSync(other, remotePath), { reporter: recorder().reporter });
    await writeWorkspaceFile(other, "components/ui/button/index.ts", "export const id = 2;\n");
    await runSnapCommand(parsedSnap(other), { reporter: silentSnapReporter });
    await runSyncCommand(parsedSync(other), { reporter: recorder().reporter });

    await writeWorkspaceFile(root, "components/ui/button/index.ts", "export const id = 3;\n");
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });

    const { results, reporter } = recorder();
    await expect(runSyncCommand(parsedSync(root), { reporter })).rejects.toThrow(
      /synchronization stopped with 1 conflict; no refs were changed/
    );
    // The report is produced before the failure, so the user sees the detail.
    expect(results).toHaveLength(1);
    expect(results[0]!.conflicts[0]).toMatch(/has diverged/);
  });
});

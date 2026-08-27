import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ComponentHistoryError } from "./errors.js";
import { createGitRunner, runGitLine } from "./git-process.js";
import { isGitObjectAlgorithm } from "./object-id.js";
import {
  checkGitAvailability,
  componentStoreDirectoryName,
  openComponentHistoryStore,
  resolveComponentStorePath,
} from "./store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function createWorkspaceRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-history-store-"));
  temporaryRoots.push(root);
  return root;
}

describe("git availability", () => {
  it("reports the installed version", async () => {
    const availability = await checkGitAvailability();
    expect(availability.version).toMatch(/^\d+\.\d+/);
  });

  it("reports which object formats the installed git accepts", async () => {
    const availability = await checkGitAvailability();
    expect(availability.supportedObjectFormats).toContain("sha1");
    for (const format of availability.supportedObjectFormats) {
      expect(isGitObjectAlgorithm(format)).toBe(true);
    }
  });

  it("gives an actionable diagnostic when git is unavailable", async () => {
    const absentGit = path.join(os.tmpdir(), "bit-lite-absent-git");
    await expect(checkGitAvailability(absentGit)).rejects.toThrow(ComponentHistoryError);
    await expect(checkGitAvailability(absentGit)).rejects.toThrow(/install Git/);
  });
});

describe("component history store", () => {
  it("resolves the store beside the workspace root, outside .bit-lite", () => {
    const storePath = resolveComponentStorePath("/workspace");
    expect(storePath).toBe(path.join("/workspace", componentStoreDirectoryName));
    expect(componentStoreDirectoryName).not.toBe(".bit-lite");
    expect(storePath).not.toContain(`${path.sep}.bit-lite${path.sep}`);
  });

  it("initializes a bare repository on first use", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const store = await openComponentHistoryStore({ workspaceRoot });

    expect(store.gitDir).toBe(resolveComponentStorePath(workspaceRoot));
    expect(await runGitLine(store.run, ["rev-parse", "--is-bare-repository"])).toBe("true");
    expect(isGitObjectAlgorithm(store.objectFormat)).toBe(true);
  });

  it("creates no refs when it initializes the store", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const store = await openComponentHistoryStore({ workspaceRoot });
    const refs = await runGitLine(store.run, ["for-each-ref", "--format=%(refname)"]);
    expect(refs).toBe("");
  });

  it("reuses an existing store instead of reinitializing it", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const first = await openComponentHistoryStore({ workspaceRoot });
    const oid = await runGitLine(first.run, ["hash-object", "-w", "-t", "blob", "--stdin"]);

    const second = await openComponentHistoryStore({ workspaceRoot });
    expect(second.gitDir).toBe(first.gitDir);
    expect(await runGitLine(second.run, ["cat-file", "-t", oid])).toBe("blob");
  });

  it("refuses to create the store when the caller only wants to open one", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    await expect(
      openComponentHistoryStore({ workspaceRoot, create: false })
    ).rejects.toThrow(/no component history store/);
  });

  it("rejects a store path that is not a git repository", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const storePath = resolveComponentStorePath(workspaceRoot);
    await mkdir(storePath, { recursive: true });
    await writeFile(path.join(storePath, "stray.txt"), "not a repository");

    await expect(openComponentHistoryStore({ workspaceRoot })).rejects.toThrow(
      /is not a Git repository/
    );
  });

  it("rejects a non-bare repository initialized at the store path", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const storePath = resolveComponentStorePath(workspaceRoot);
    await createGitRunner()({ args: ["init", "--quiet", storePath] });

    await expect(openComponentHistoryStore({ workspaceRoot })).rejects.toThrow(
      /must be a bare Git repository, but it is a worktree containing \.git/
    );
  });

  it("rejects a store whose bare flag was cleared", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const store = await openComponentHistoryStore({ workspaceRoot });
    await store.run({ args: ["config", "core.bare", "false"] });

    await expect(openComponentHistoryStore({ workspaceRoot })).rejects.toThrow(
      /must be a bare Git repository, but it has a worktree/
    );
  });

  it("reports a missing git executable before touching the workspace", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    await expect(
      openComponentHistoryStore({
        workspaceRoot,
        gitPath: path.join(os.tmpdir(), "bit-lite-absent-git"),
      })
    ).rejects.toThrow(/install Git/);

    await expect(
      rm(resolveComponentStorePath(workspaceRoot), { recursive: true })
    ).rejects.toThrow();
  });
});

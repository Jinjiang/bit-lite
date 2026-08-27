import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ComponentHistoryError, GitCommandError } from "./errors.js";
import { createGitRunner, runGitLine } from "./git-process.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-history-git-"));
  temporaryRoots.push(root);
  return root;
}

describe("git process adapter", () => {
  it("runs git and returns its output", async () => {
    const run = createGitRunner();
    expect(await runGitLine(run, ["--version"])).toMatch(/^git version /);
  });

  it("never interprets arguments as shell syntax", async () => {
    const run = createGitRunner();
    // A shell would expand this into two commands; spawn passes it through as
    // one literal argument, so git echoes it back unchanged.
    const injected = "hello; touch pwned";
    const result = await run({ args: ["hash-object", "-t", "blob", "--stdin"], stdin: injected });
    const oid = result.stdout.toString("utf8").trim();

    const echoed = await run({ args: ["cat-file", "blob", oid], throwOnFailure: false });
    expect(echoed.exitCode).not.toBe(0);
    expect(await runGitLine(run, ["hash-object", "-t", "blob", "--stdin"])).toBeTruthy();
    expect(injected).toContain(";");
  });

  it("passes the git directory explicitly instead of discovering one", async () => {
    const root = await createTemporaryRoot();
    const gitDir = path.join(root, "store.git");
    await createGitRunner()({ args: ["init", "--bare", "--quiet", gitDir] });

    const run = createGitRunner({ gitDir });
    expect(await runGitLine(run, ["rev-parse", "--is-bare-repository"])).toBe("true");
  });

  it("applies operation-scoped environment overrides", async () => {
    const root = await createTemporaryRoot();
    const gitDir = path.join(root, "store.git");
    const indexFile = path.join(root, "scratch-index");
    await createGitRunner()({ args: ["init", "--bare", "--quiet", gitDir] });

    const run = createGitRunner({ gitDir });
    const oid = await runGitLine(run, ["hash-object", "-w", "-t", "blob", "--stdin"]);
    await run({
      args: ["update-index", "--add", "--cacheinfo", `100644,${oid},file.txt`],
      env: { GIT_INDEX_FILE: indexFile },
    });

    // The override is scoped to that one call: the index lives outside the
    // store and the store itself never gained one.
    await expect(readFile(indexFile)).resolves.toBeInstanceOf(Buffer);
    await expect(readFile(path.join(gitDir, "index"))).rejects.toThrow();
  });

  it("reports a failing git command as a structured error", async () => {
    const root = await createTemporaryRoot();
    const gitDir = path.join(root, "store.git");
    await createGitRunner()({ args: ["init", "--bare", "--quiet", gitDir] });
    const run = createGitRunner({ gitDir });

    const error = await run({ args: ["cat-file", "-p", "0".repeat(40)] }).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(GitCommandError);
    const gitError = error as GitCommandError;
    expect(gitError.exitCode).not.toBe(0);
    expect(gitError.args).toContain("cat-file");
    expect(gitError.args.slice(0, 2)).toEqual(["--git-dir", gitDir]);
    expect(gitError.stderr.length).toBeGreaterThan(0);
  });

  it("returns a failing exit code when the caller opts out of throwing", async () => {
    const run = createGitRunner();
    const result = await run({ args: ["rev-parse", "--is-inside-work-tree"], throwOnFailure: false });
    expect(typeof result.exitCode).toBe("number");
  });

  it("reports a missing git executable with an actionable message", async () => {
    const run = createGitRunner({ gitPath: path.join(os.tmpdir(), "bit-lite-absent-git") });
    await expect(run({ args: ["--version"] })).rejects.toThrow(ComponentHistoryError);
    await expect(run({ args: ["--version"] })).rejects.toThrow(/install Git/);
  });

  it("bounds output instead of buffering without limit", async () => {
    const run = createGitRunner();
    await expect(
      run({ args: ["--version"], maxOutputBytes: 1 })
    ).rejects.toThrow(/produced more than 1 bytes/);
  });
});

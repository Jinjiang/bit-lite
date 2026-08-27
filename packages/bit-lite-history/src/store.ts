import { stat } from "node:fs/promises";
import path from "node:path";
import { ComponentHistoryError } from "./errors.js";
import {
  createGitRunner,
  runGitLine,
  type GitRunner,
} from "./git-process.js";
import { isGitObjectAlgorithm, type GitObjectAlgorithm } from "./object-id.js";

/**
 * The durable component history store. It is deliberately *not* inside
 * `.bit-lite`, which existing demo and development workflows delete as
 * disposable cache state.
 */
export const componentStoreDirectoryName = ".bit-lite-store.git";

export type ComponentHistoryStore = {
  /** Absolute path of the bare repository. */
  gitDir: string;
  /** Object format the store was created with; never assumed to be SHA-1. */
  objectFormat: GitObjectAlgorithm;
  /** Runs Git against this store with `--git-dir` already applied. */
  run: GitRunner;
};

export type OpenComponentHistoryStoreOptions = {
  workspaceRoot: string;
  /** When false, an absent store is an error instead of being created. */
  create?: boolean;
  gitPath?: string;
};

export function resolveComponentStorePath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), componentStoreDirectoryName);
}

export type GitAvailability = {
  version: string;
  supportedObjectFormats: readonly GitObjectAlgorithm[];
};

/**
 * Confirms Git can run at all before any versioning command touches the store,
 * so an absent Git produces one actionable diagnostic rather than a failure
 * deep inside snapshot preparation.
 */
export async function checkGitAvailability(gitPath = "git"): Promise<GitAvailability> {
  const run = createGitRunner({ gitPath });
  const output = await runGitLine(run, ["--version"]);
  const version = output.replace(/^git version /, "").trim();
  if (version.length === 0) {
    throw new ComponentHistoryError(
      `git executable "${gitPath}" did not report a usable version`
    );
  }
  return { version, supportedObjectFormats: await detectObjectFormats(run) };
}

/**
 * Opens the workspace store, initializing a bare repository on first use.
 * Existing non-versioning commands never call this, so they stay independent
 * of Git.
 */
export async function openComponentHistoryStore(
  options: OpenComponentHistoryStoreOptions
): Promise<ComponentHistoryStore> {
  const gitPath = options.gitPath ?? "git";
  await checkGitAvailability(gitPath);

  const gitDir = resolveComponentStorePath(options.workspaceRoot);
  const exists = await directoryExists(gitDir);
  if (!exists) {
    if (options.create === false) {
      throw new ComponentHistoryError(
        `no component history store at ${gitDir}; run "bit-lite snap" to create one`
      );
    }
    await initializeBareStore(gitPath, gitDir);
  }

  const run = createGitRunner({ gitDir, gitPath });
  await assertBareRepository(run, gitDir);
  return { gitDir, objectFormat: await readObjectFormat(run, gitDir), run };
}

async function initializeBareStore(gitPath: string, gitDir: string): Promise<void> {
  // `git init --bare <path>` takes the directory as a positional argument, so
  // this runner intentionally carries no --git-dir.
  const run = createGitRunner({ gitPath });
  await run({ args: ["init", "--bare", "--quiet", gitDir] });
}

async function assertBareRepository(run: GitRunner, gitDir: string): Promise<void> {
  const result = await run({
    args: ["rev-parse", "--is-bare-repository"],
    throwOnFailure: false,
  });

  if (result.exitCode !== 0) {
    // A non-bare `git init` here puts the repository in `<gitDir>/.git` and
    // leaves `<gitDir>` itself a worktree, which is a different mistake from
    // an unrelated directory sitting at the store path.
    if (await directoryExists(path.join(gitDir, ".git"))) {
      throw new ComponentHistoryError(
        `${gitDir} must be a bare Git repository, but it is a worktree containing .git`
      );
    }
    throw new ComponentHistoryError(
      `${gitDir} exists but is not a Git repository; move or remove it and rerun the command`
    );
  }

  if (result.stdout.toString("utf8").trim() !== "true") {
    throw new ComponentHistoryError(
      `${gitDir} must be a bare Git repository, but it has a worktree`
    );
  }
}

async function readObjectFormat(
  run: GitRunner,
  gitDir: string
): Promise<GitObjectAlgorithm> {
  const format = await runGitLine(run, ["rev-parse", "--show-object-format"]);
  if (!isGitObjectAlgorithm(format)) {
    throw new ComponentHistoryError(
      `${gitDir} uses unsupported Git object format "${format}"`
    );
  }
  return format;
}

/**
 * Reports which object formats the installed Git accepts. SHA-256 support is
 * version dependent, so it is probed rather than assumed in either direction.
 */
async function detectObjectFormats(
  run: GitRunner
): Promise<readonly GitObjectAlgorithm[]> {
  const formats: GitObjectAlgorithm[] = ["sha1"];
  const result = await run({
    args: ["hash-object", "--object-format=sha256", "-t", "blob", "--stdin"],
    stdin: "",
    throwOnFailure: false,
  });
  if (result.exitCode === 0) formats.push("sha256");
  return formats;
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

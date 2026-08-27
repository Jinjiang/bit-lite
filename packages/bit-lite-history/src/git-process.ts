import { spawn } from "node:child_process";
import { ComponentHistoryError, GitCommandError } from "./errors.js";

/**
 * What: the single place component history talks to Git.
 *
 * Why: every invocation passes an argument array to `spawn` with no shell, so
 * component IDs, paths, URLs, and versions can never be reinterpreted as shell
 * syntax. Output is bounded and converted into structured errors, and the only
 * environment overrides are operation-scoped values such as a temporary index.
 */

/** Guards against a runaway Git command filling memory. */
export const defaultMaxOutputBytes = 64 * 1024 * 1024;

export type GitCommandInput = {
  args: readonly string[];
  /** Written to Git's stdin and then closed. */
  stdin?: string | Uint8Array;
  /** Operation-scoped variables merged over the inherited environment. */
  env?: Readonly<Record<string, string>>;
  maxOutputBytes?: number;
  /**
   * When `false`, a non-zero exit is returned rather than thrown. Use it for
   * commands whose failure is a meaningful answer, such as `merge-base
   * --is-ancestor`.
   */
  throwOnFailure?: boolean;
};

export type GitCommandResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: string;
};

export type GitRunner = (input: GitCommandInput) => Promise<GitCommandResult>;

export type CreateGitRunnerOptions = {
  /** Absolute path passed as `--git-dir`; omitted for store-independent commands. */
  gitDir?: string;
  gitPath?: string;
};

/**
 * Variables that keep Git non-interactive and free of ambient repository
 * discovery. They are overrides, not a scrubbed environment: Git still needs
 * the inherited `PATH`, `HOME`, and credential configuration to work.
 */
const baseGitEnvironment: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  LC_ALL: "C",
};

export function createGitRunner(options: CreateGitRunnerOptions = {}): GitRunner {
  const gitPath = options.gitPath ?? "git";
  const gitDir = options.gitDir;

  return async function runGit(input: GitCommandInput): Promise<GitCommandResult> {
    // --git-dir precedes the subcommand and is supplied explicitly so Git never
    // discovers a repository from the current working directory.
    const args = gitDir === undefined ? [...input.args] : ["--git-dir", gitDir, ...input.args];
    const maxOutputBytes = input.maxOutputBytes ?? defaultMaxOutputBytes;
    const result = await spawnGit(gitPath, args, input, maxOutputBytes);

    if (input.throwOnFailure !== false && result.exitCode !== 0) {
      throw new GitCommandError({
        args,
        exitCode: result.exitCode,
        signal: result.signal,
        stderr: result.stderr,
      });
    }
    return result;
  };
}

/** Convenience wrapper for commands whose stdout is a single line. */
export async function runGitLine(run: GitRunner, args: readonly string[]): Promise<string> {
  const result = await run({ args });
  return result.stdout.toString("utf8").trim();
}

function spawnGit(
  gitPath: string,
  args: readonly string[],
  input: GitCommandInput,
  maxOutputBytes: number
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(gitPath, args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...baseGitEnvironment, ...input.env },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(error);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maxOutputBytes) {
        fail(
          new ComponentHistoryError(
            `git ${args.join(" ")} produced more than ${maxOutputBytes} bytes on stdout`
          )
        );
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > maxOutputBytes) {
        fail(
          new ComponentHistoryError(
            `git ${args.join(" ")} produced more than ${maxOutputBytes} bytes on stderr`
          )
        );
        return;
      }
      stderrChunks.push(chunk);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (isMissingExecutable(error)) {
        reject(
          new ComponentHistoryError(
            `git executable "${gitPath}" was not found; install Git to use component versioning commands`,
            { cause: error }
          )
        );
        return;
      }
      reject(
        new ComponentHistoryError(`git ${args.join(" ")} could not be started`, { cause: error })
      );
    });

    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });

    if (input.stdin !== undefined) {
      child.stdin.end(input.stdin);
    } else {
      child.stdin.end();
    }
  });
}

function isMissingExecutable(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

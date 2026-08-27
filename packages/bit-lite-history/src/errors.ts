/**
 * What: marks an error as coming from component history logic instead of a raw
 * system or JavaScript failure.
 *
 * Where: throw this from store discovery, ref encoding, snapshot capture, and
 * Git invocation when the message should be shown directly to a user.
 */
export class ComponentHistoryError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "ComponentHistoryError";
  }
}

/**
 * What: reports a Git subprocess that ran to completion but reported failure.
 *
 * Where: thrown by the Git process adapter so callers can inspect the exact
 * argument array and exit code instead of parsing a formatted message. The
 * message carries only the arguments and captured stderr, so no unrelated
 * process environment leaks into user-facing output.
 */
export class GitCommandError extends ComponentHistoryError {
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;

  constructor(input: {
    args: readonly string[];
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
  }) {
    const reason =
      input.exitCode === null
        ? `terminated by ${input.signal ?? "an unknown signal"}`
        : `exited with code ${input.exitCode}`;
    const detail = input.stderr.trim();
    super(`git ${input.args.join(" ")} ${reason}${detail.length > 0 ? `: ${detail}` : ""}`);
    this.name = "GitCommandError";
    this.args = [...input.args];
    this.exitCode = input.exitCode;
    this.signal = input.signal;
    this.stderr = input.stderr;
  }
}

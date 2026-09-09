import { throwCombinedErrors } from "bit-lite-utils";

/**
 * What: shutdown for a command that owns several resources.
 *
 * Why: a watch command owns tasks, a proxy, listeners, and temporary
 * directories, and every one of them must be released even when an earlier one
 * fails — otherwise a failure during cleanup leaks whatever came after it.
 * Writing that as a try/catch per resource is what this replaces; five commands
 * had their own copy, and they did not all get it right.
 */
export async function disposeAll(
  message: string,
  steps: readonly (undefined | (() => void | Promise<void>))[]
): Promise<void> {
  const failures: unknown[] = [];
  for (const step of steps) {
    if (step === undefined) continue;
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  throwCombinedErrors(failures, message);
}

/**
 * Makes an asynchronous action idempotent: every caller after the first joins
 * the run already in flight, including the one that failed. Disposal is asked
 * for from several directions at once — a signal, a supervisor's `finally`,
 * and the command's own error path — and all of them mean the same request.
 */
export function once<Result>(run: () => Promise<Result>): () => Promise<Result> {
  let pending: Promise<Result> | undefined;
  return () => (pending ??= run());
}

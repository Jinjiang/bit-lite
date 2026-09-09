import { openComponentHistoryStore, resolveComponentStorePath } from "bit-lite-history";
import type { ComponentHistoryStore } from "bit-lite-history";
import { isDirectory } from "bit-lite-utils/node";

/**
 * Opens the workspace's component history store if it has one.
 *
 * `status`, `log`, and `diff` only ever read, so a workspace that has never
 * recorded anything is an answer they give rather than a failure — and they
 * must not bring a store into existence by asking. Returning `undefined`
 * instead of creating one is what keeps that promise, and it is why these
 * commands work in a workspace that was only just cloned.
 */
export async function openRecordedHistory(
  workspaceRoot: string
): Promise<ComponentHistoryStore | undefined> {
  if (!(await isDirectory(resolveComponentStorePath(workspaceRoot)))) return undefined;
  return openComponentHistoryStore({ workspaceRoot, create: false });
}

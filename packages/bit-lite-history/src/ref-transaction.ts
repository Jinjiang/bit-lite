import { formatObjectId, nullObjectId, type GitObjectId } from "./object-id.js";
import type { ComponentHistoryStore } from "./store.js";

/**
 * What: applies a set of local ref updates as one all-or-nothing change.
 *
 * Why: one command can record several components, and users must never observe
 * half of that. Each update also carries the value Bit Lite read earlier as its
 * expected old value, so a ref that moved concurrently fails the transaction
 * instead of being silently overwritten.
 */

export type RefUpdate = {
  ref: string;
  newValue: GitObjectId;
  /** The value read during preparation; `undefined` means the ref must not exist. */
  expectedOldValue: GitObjectId | undefined;
};

export async function updateRefsAtomically(
  store: ComponentHistoryStore,
  updates: readonly RefUpdate[]
): Promise<void> {
  if (updates.length === 0) return;

  // `update-ref --stdin` is transactional on its own: it takes every lock
  // before committing any change, so no separate transaction log is needed.
  //
  // The line-based format is `update <ref> <new-value> <old-value>`. It is
  // unambiguous here because every ref this package builds is composed of fixed
  // prefixes and a base64url component key, so a ref can never contain a space.
  const commands = updates
    .map((update) => {
      const oldValue = update.expectedOldValue ?? nullObjectId(store.objectFormat);
      return `update ${update.ref} ${update.newValue.hex} ${oldValue.hex}\n`;
    })
    .join("");

  await store.run({ args: ["update-ref", "--stdin"], stdin: commands });
}

export function describeRefUpdate(update: RefUpdate): string {
  const from =
    update.expectedOldValue === undefined ? "(new)" : formatObjectId(update.expectedOldValue);
  return `${update.ref}: ${from} -> ${formatObjectId(update.newValue)}`;
}

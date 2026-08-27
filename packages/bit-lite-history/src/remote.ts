import { ComponentHistoryError } from "./errors.js";
import type { ComponentHistoryStore } from "./store.js";

/**
 * What: resolves which remote a sync talks to, and configures it on first use.
 *
 * Why: the remote lives inside the component store, never in the workspace
 * source repository, so publishing component history can never touch the user's
 * own Git remotes. Replacing an already-configured URL is refused rather than
 * applied, because silently redirecting a component history to a different
 * destination is the kind of mistake that is discovered too late.
 */

export const defaultRemoteName = "origin";

export async function readStoreRemoteUrl(
  store: ComponentHistoryStore,
  remote = defaultRemoteName
): Promise<string | undefined> {
  const result = await store.run({
    args: ["config", "--get", `remote.${remote}.url`],
    throwOnFailure: false,
  });
  if (result.exitCode !== 0) return undefined;
  const url = result.stdout.toString("utf8").trim();
  return url.length === 0 ? undefined : url;
}

export type ResolveStoreRemoteInput = {
  /** URL supplied by `--remote`, if any. */
  requestedUrl?: string;
  remote?: string;
};

/**
 * Returns the URL to synchronize with, configuring `origin` when the store has
 * none yet.
 */
export async function resolveStoreRemote(
  store: ComponentHistoryStore,
  input: ResolveStoreRemoteInput = {}
): Promise<{ remote: string; url: string }> {
  const remote = input.remote ?? defaultRemoteName;
  const configuredUrl = await readStoreRemoteUrl(store, remote);

  if (configuredUrl === undefined) {
    if (input.requestedUrl === undefined) {
      throw new ComponentHistoryError(
        `no component history remote is configured; run "bit-lite sync --remote <url>" once to set one`
      );
    }
    await store.run({ args: ["remote", "add", remote, input.requestedUrl] });
    return { remote, url: input.requestedUrl };
  }

  if (input.requestedUrl !== undefined && input.requestedUrl !== configuredUrl) {
    throw new ComponentHistoryError(
      `component history remote "${remote}" is already ${configuredUrl}; refusing to replace it with ${input.requestedUrl}`
    );
  }

  return { remote, url: configuredUrl };
}

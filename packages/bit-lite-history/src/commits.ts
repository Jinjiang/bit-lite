import { ComponentHistoryError } from "./errors.js";
import { createObjectId, formatObjectId, type GitObjectId } from "./object-id.js";
import { componentHeadRef } from "./refs.js";
import type { ComponentHistoryStore } from "./store.js";

/**
 * What: creates and inspects the commits that form one component's history.
 *
 * Why: a component history is deliberately linear. Every commit has the
 * previous snap of the same component as its only parent, so
 * `git log <component head>` reads as that component's history and nothing
 * else. Nothing here ever creates a merge or a cross-component parent.
 */

export type ComponentCommit = {
  id: GitObjectId;
  treeId: GitObjectId;
  parentIds: readonly GitObjectId[];
};

/** Deterministic in shape; audit detail comes from Git's own author metadata. */
export function buildCommitMessage(componentId: string): string {
  return `snap ${componentId}`;
}

export async function readComponentHead(
  store: ComponentHistoryStore,
  componentId: string
): Promise<GitObjectId | undefined> {
  const result = await store.run({
    args: ["rev-parse", "--verify", "--quiet", `${componentHeadRef(componentId)}^{commit}`],
    throwOnFailure: false,
  });
  if (result.exitCode !== 0) return undefined;
  return createObjectId(result.stdout.toString("utf8"), store.objectFormat);
}

export async function readComponentCommit(
  store: ComponentHistoryStore,
  commitId: GitObjectId
): Promise<ComponentCommit> {
  const result = await store.run({
    args: ["cat-file", "commit", commitId.hex],
  });
  const header = result.stdout.toString("utf8").split("\n\n", 1)[0] ?? "";

  const treeLine = header
    .split("\n")
    .find((line) => line.startsWith("tree "))
    ?.slice("tree ".length);
  if (treeLine === undefined) {
    throw new ComponentHistoryError(
      `commit ${formatObjectId(commitId)} has no tree and is not a usable component snap`
    );
  }

  const parentIds = header
    .split("\n")
    .filter((line) => line.startsWith("parent "))
    .map((line) => createObjectId(line.slice("parent ".length), store.objectFormat));

  return {
    id: commitId,
    treeId: createObjectId(treeLine, store.objectFormat),
    parentIds,
  };
}

export type CreateComponentCommitInput = {
  componentId: string;
  treeId: GitObjectId;
  /** The component's current head, or `undefined` for that component's first snap. */
  parentId: GitObjectId | undefined;
};

export async function createComponentCommit(
  store: ComponentHistoryStore,
  input: CreateComponentCommitInput
): Promise<GitObjectId> {
  const args = ["commit-tree", input.treeId.hex];
  if (input.parentId !== undefined) {
    await assertSameComponentParent(store, input.componentId, input.parentId);
    args.push("-p", input.parentId.hex);
  }
  args.push("-m", buildCommitMessage(input.componentId));

  const result = await store.run({ args });
  return createObjectId(result.stdout.toString("utf8"), store.objectFormat);
}

/**
 * Guards the two invariants a component history depends on: every commit is
 * linear, and a parent always belongs to the same component. A malformed store
 * is reported rather than repaired.
 */
export async function assertLinearComponentHistory(
  store: ComponentHistoryStore,
  componentId: string,
  headId: GitObjectId
): Promise<void> {
  const seen = new Set<string>();
  let current: GitObjectId | undefined = headId;

  while (current !== undefined) {
    if (seen.has(current.hex)) {
      throw new ComponentHistoryError(
        `component "${componentId}" history contains a cycle at ${formatObjectId(current)}`
      );
    }
    seen.add(current.hex);

    const commit: ComponentCommit = await readComponentCommit(store, current);
    if (commit.parentIds.length > 1) {
      throw new ComponentHistoryError(
        `component "${componentId}" commit ${formatObjectId(current)} has ${commit.parentIds.length} parents, but component history must be linear`
      );
    }
    current = commit.parentIds[0];
  }
}

/**
 * A parent must already be reachable from the component's own head, which is
 * what prevents one component's snap from being grafted onto another's.
 */
async function assertSameComponentParent(
  store: ComponentHistoryStore,
  componentId: string,
  parentId: GitObjectId
): Promise<void> {
  const head = await readComponentHead(store, componentId);
  if (head === undefined) {
    throw new ComponentHistoryError(
      `component "${componentId}" has no history, so ${formatObjectId(parentId)} cannot be a parent`
    );
  }
  const result = await store.run({
    args: ["merge-base", "--is-ancestor", parentId.hex, head.hex],
    throwOnFailure: false,
  });
  if (result.exitCode !== 0) {
    throw new ComponentHistoryError(
      `commit ${formatObjectId(parentId)} is not part of component "${componentId}" history`
    );
  }
}

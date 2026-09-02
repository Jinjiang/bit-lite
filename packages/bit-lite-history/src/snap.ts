import { createComponentCommit, readComponentHead } from "./commits.js";
import { readCommitTree, writeSnapshotTree } from "./objects.js";
import { formatObjectId, objectIdsEqual, type GitObjectId } from "./object-id.js";
import { componentHeadRef } from "./refs.js";
import { updateRefsAtomically, type RefUpdate } from "./ref-transaction.js";
import { readComponentSnapshot } from "./snapshot.js";
import type { ComponentHistoryStore } from "./store.js";

/**
 * What: records the selected components as one local operation.
 *
 * Why: object preparation and ref publication are deliberately separate. All
 * blobs, trees, and commits for every selected component are created first; if
 * any component fails, publication never starts and no component ref moves.
 * Objects written before the failure are simply unreachable and are left to
 * ordinary Git garbage collection.
 */

/** One component the caller asked to record. */
export type SnapRequest = {
  componentId: string;
  rootDir: string;
  /**
   * Component-relative POSIX paths whose recorded bytes differ from the bytes
   * on disk. The history layer neither builds nor interprets these; a caller
   * that derives recorded metadata from workspace state supplies them.
   */
  contentOverrides?: ReadonlyMap<string, Uint8Array>;
  /** Replaces the generated commit message for this component. */
  message?: string;
};

export type ComponentSnapStatus = "created" | "unchanged";

export type ComponentSnapResult = {
  componentId: string;
  status: ComponentSnapStatus;
  /** Algorithm-qualified commit ID: the snap's identity in its history. */
  snapId: string;
  /** Algorithm-qualified tree ID: the snap's content identity. */
  treeId: string;
  fileCount: number;
};

export type SnapResult = {
  components: readonly ComponentSnapResult[];
  changed: readonly ComponentSnapResult[];
  unchanged: readonly ComponentSnapResult[];
};

/**
 * A component whose objects exist but whose ref has not moved. Callers that
 * drive their own ordering read `snapId` between preparations, because a
 * component's identity is settled here even though it is not yet published.
 */
export type PreparedComponentSnap = {
  componentId: string;
  treeId: GitObjectId;
  fileCount: number;
  head: GitObjectId | undefined;
  /** `undefined` when the captured tree matched the head and nothing was committed. */
  commitId: GitObjectId | undefined;
  /** The commit this component is at once published: the new commit, or the unchanged head. */
  snapId: GitObjectId;
};

/**
 * Records the given components as one operation. Callers needing to interleave
 * work between components — resolving a dependency's version before preparing
 * its dependent, for instance — drive `prepareComponentSnap` and
 * `publishComponentSnaps` directly instead.
 */
export async function snapComponents(
  store: ComponentHistoryStore,
  requests: readonly SnapRequest[]
): Promise<SnapResult> {
  assertUniqueComponents(requests.map((request) => request.componentId));

  const prepared: PreparedComponentSnap[] = [];
  for (const request of requests) {
    prepared.push(await prepareComponentSnap(store, request));
  }
  return publishComponentSnaps(store, prepared);
}

/**
 * Creates every object one component needs without moving its ref. Preparing a
 * component has no visible effect: objects written for a component that is
 * never published are simply unreachable.
 */
export async function prepareComponentSnap(
  store: ComponentHistoryStore,
  request: SnapRequest
): Promise<PreparedComponentSnap> {
  const snapshot = await readComponentSnapshot(request);
  const treeId = await writeSnapshotTree(store, snapshot);
  const head = await readComponentHead(store, request.componentId);

  if (head !== undefined) {
    // Content identity, not commit identity: an unchanged tree means the
    // component did not change, whatever else moved in the workspace.
    const headTreeId = await readCommitTree(store, head);
    if (objectIdsEqual(headTreeId, treeId)) {
      return {
        componentId: request.componentId,
        treeId,
        fileCount: snapshot.files.length,
        head,
        commitId: undefined,
        snapId: head,
      };
    }
  }

  const commitId = await createComponentCommit(store, {
    componentId: request.componentId,
    treeId,
    parentId: head,
    ...(request.message === undefined ? {} : { message: request.message }),
  });

  return {
    componentId: request.componentId,
    treeId,
    fileCount: snapshot.files.length,
    head,
    commitId,
    snapId: commitId,
  };
}

/**
 * Moves every changed component's ref in one transaction. Publication happens
 * only after all callers' preparation succeeded, so a failure anywhere leaves
 * every component history exactly where it was.
 */
export async function publishComponentSnaps(
  store: ComponentHistoryStore,
  prepared: readonly PreparedComponentSnap[]
): Promise<SnapResult> {
  assertUniqueComponents(prepared.map((component) => component.componentId));

  const updates: RefUpdate[] = prepared
    .filter((component): component is PreparedComponentSnap & { commitId: GitObjectId } =>
      component.commitId !== undefined
    )
    .map((component) => ({
      ref: componentHeadRef(component.componentId),
      newValue: component.commitId,
      expectedOldValue: component.head,
    }));

  await updateRefsAtomically(store, updates);
  return describeComponentSnaps(prepared);
}

/**
 * Summarizes prepared components without publishing anything, so a caller can
 * report exactly what publication would do. Preparation has already settled
 * every component's identity, so the summary is the same one publication
 * produces.
 */
export function describeComponentSnaps(
  prepared: readonly PreparedComponentSnap[]
): SnapResult {
  const components = prepared.map((component) => toResult(component));
  return {
    components,
    changed: components.filter((component) => component.status === "created"),
    unchanged: components.filter((component) => component.status === "unchanged"),
  };
}

function toResult(component: PreparedComponentSnap): ComponentSnapResult {
  return {
    componentId: component.componentId,
    status: component.commitId === undefined ? "unchanged" : "created",
    snapId: formatObjectId(component.snapId),
    treeId: formatObjectId(component.treeId),
    fileCount: component.fileCount,
  };
}

function assertUniqueComponents(componentIds: readonly string[]): void {
  const seen = new Set<string>();
  for (const componentId of componentIds) {
    if (seen.has(componentId)) {
      throw new Error(`component "${componentId}" was selected more than once`);
    }
    seen.add(componentId);
  }
}

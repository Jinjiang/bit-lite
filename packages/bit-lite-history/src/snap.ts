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

type PreparedComponent = {
  componentId: string;
  treeId: GitObjectId;
  fileCount: number;
  head: GitObjectId | undefined;
  commitId: GitObjectId | undefined;
};

export async function snapComponents(
  store: ComponentHistoryStore,
  requests: readonly SnapRequest[]
): Promise<SnapResult> {
  assertUniqueComponents(requests);

  const prepared: PreparedComponent[] = [];
  for (const request of requests) {
    prepared.push(await prepareComponent(store, request));
  }

  const updates: RefUpdate[] = prepared
    .filter((component): component is PreparedComponent & { commitId: GitObjectId } =>
      component.commitId !== undefined
    )
    .map((component) => ({
      ref: componentHeadRef(component.componentId),
      newValue: component.commitId,
      expectedOldValue: component.head,
    }));

  // Nothing is published until every selected component prepared successfully.
  await updateRefsAtomically(store, updates);

  const components = prepared.map((component) => toResult(component));
  return {
    components,
    changed: components.filter((component) => component.status === "created"),
    unchanged: components.filter((component) => component.status === "unchanged"),
  };
}

async function prepareComponent(
  store: ComponentHistoryStore,
  request: SnapRequest
): Promise<PreparedComponent> {
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
      };
    }
  }

  const commitId = await createComponentCommit(store, {
    componentId: request.componentId,
    treeId,
    parentId: head,
  });

  return {
    componentId: request.componentId,
    treeId,
    fileCount: snapshot.files.length,
    head,
    commitId,
  };
}

function toResult(component: PreparedComponent): ComponentSnapResult {
  const snapId = component.commitId ?? component.head;
  if (snapId === undefined) {
    throw new Error(`component "${component.componentId}" produced neither a commit nor a head`);
  }
  return {
    componentId: component.componentId,
    status: component.commitId === undefined ? "unchanged" : "created",
    snapId: formatObjectId(snapId),
    treeId: formatObjectId(component.treeId),
    fileCount: component.fileCount,
  };
}

function assertUniqueComponents(requests: readonly SnapRequest[]): void {
  const seen = new Set<string>();
  for (const request of requests) {
    if (seen.has(request.componentId)) {
      throw new Error(`component "${request.componentId}" was selected more than once`);
    }
    seen.add(request.componentId);
  }
}

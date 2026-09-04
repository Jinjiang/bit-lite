import { createHash } from "node:crypto";
import { ComponentHistoryError } from "./errors.js";
import { createObjectId, type GitObjectAlgorithm, type GitObjectId } from "./object-id.js";
import type { ComponentSnapshot } from "./snapshot.js";

/**
 * What: derives a component's tree ID from its snapshot without writing
 * anything.
 *
 * Why this exists at all: the recording path builds the tree by handing a flat
 * entry list to a temporary index and letting `write-tree` assemble the nested
 * subtrees — which stores every one of them. Git offers no read-only
 * equivalent, so a command that only inspects has to serialize and hash the
 * tree objects itself.
 *
 * That makes this a genuine second implementation of something Git already
 * does, and the reason it is acceptable is that the two are pinned together by
 * a test asserting they agree on the same component. Treat a failure there as
 * a bug here, never as a reason to loosen the comparison.
 *
 * Two details are easy to get wrong and are the whole substance of the module:
 * a tree entry's mode for a subdirectory is `40000` with no leading zero, and
 * entries are ordered as though a directory's name ended in `/`, which is not
 * the order the snapshot's flat paths are already in.
 */

/** Git's mode for a subdirectory entry. Deliberately not zero-padded. */
const treeEntryMode = "40000";

type TreeNode = {
  blobs: Map<string, { mode: string; hex: string }>;
  directories: Map<string, TreeNode>;
};

/**
 * Computes the tree ID the recording path would produce for the same snapshot
 * and the same blob IDs.
 *
 * Blob IDs are passed in rather than computed here so the caller can hash them
 * through Git, which keeps the one part of content identity that must match
 * Git exactly out of this module's hands.
 */
export function computeSnapshotTreeId(
  snapshot: ComponentSnapshot,
  blobIds: readonly GitObjectId[],
  algorithm: GitObjectAlgorithm
): GitObjectId {
  if (blobIds.length !== snapshot.files.length) {
    throw new ComponentHistoryError(
      `component "${snapshot.componentId}" has ${snapshot.files.length} files but ` +
        `${blobIds.length} blob ids`
    );
  }

  const root = createTreeNode();
  for (const [position, file] of snapshot.files.entries()) {
    insertFile(snapshot.componentId, root, file.path, file.mode, blobIds[position]!.hex);
  }
  return createObjectId(hashTreeNode(root, algorithm), algorithm);
}

function createTreeNode(): TreeNode {
  return { blobs: new Map(), directories: new Map() };
}

function insertFile(
  componentId: string,
  root: TreeNode,
  filePath: string,
  mode: string,
  blobHex: string
): void {
  const segments = filePath.split("/");
  const name = segments.pop();
  if (name === undefined || name.length === 0) {
    throw new ComponentHistoryError(
      `component "${componentId}" produced an unusable tree path "${filePath}"`
    );
  }

  let node = root;
  for (const segment of segments) {
    // A path cannot be both a file and a directory on the filesystem the
    // snapshot walked, so this only fires on a caller-constructed snapshot.
    if (node.blobs.has(segment)) {
      throw new ComponentHistoryError(
        `component "${componentId}" has both a file and a directory named "${segment}"`
      );
    }
    let child = node.directories.get(segment);
    if (child === undefined) {
      child = createTreeNode();
      node.directories.set(segment, child);
    }
    node = child;
  }

  if (node.directories.has(name)) {
    throw new ComponentHistoryError(
      `component "${componentId}" has both a file and a directory named "${name}"`
    );
  }
  node.blobs.set(name, { mode, hex: blobHex });
}

function hashTreeNode(node: TreeNode, algorithm: GitObjectAlgorithm): string {
  const entries: { sortKey: Buffer; bytes: Buffer }[] = [];

  for (const [name, blob] of node.blobs) {
    entries.push({
      sortKey: Buffer.from(name, "utf8"),
      bytes: encodeTreeEntry(blob.mode, name, blob.hex),
    });
  }
  for (const [name, child] of node.directories) {
    entries.push({
      // The trailing slash is the ordering rule, not part of the stored name.
      sortKey: Buffer.from(`${name}/`, "utf8"),
      bytes: encodeTreeEntry(treeEntryMode, name, hashTreeNode(child, algorithm)),
    });
  }

  entries.sort((left, right) => Buffer.compare(left.sortKey, right.sortKey));
  return hashGitObject("tree", Buffer.concat(entries.map((entry) => entry.bytes)), algorithm);
}

function encodeTreeEntry(mode: string, name: string, hex: string): Buffer {
  return Buffer.concat([Buffer.from(`${mode} ${name}\0`, "utf8"), Buffer.from(hex, "hex")]);
}

/** Git object identity: the type and length header, then the raw body. */
function hashGitObject(
  type: string,
  body: Buffer,
  algorithm: GitObjectAlgorithm
): string {
  return createHash(algorithm)
    .update(Buffer.from(`${type} ${body.length}\0`, "utf8"))
    .update(body)
    .digest("hex");
}

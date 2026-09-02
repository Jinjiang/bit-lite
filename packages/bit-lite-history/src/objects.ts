import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ComponentHistoryError } from "./errors.js";
import { createObjectId, type GitObjectId } from "./object-id.js";
import type { ComponentHistoryStore } from "./store.js";
import type { ComponentSnapshot } from "./snapshot.js";

/**
 * What: turns a component snapshot into Git blob and tree objects.
 *
 * Why: the store is bare, so there is no index or worktree to reuse. Blobs are
 * hashed in one batched `hash-object` call and assembled through an
 * operation-scoped temporary index, which keeps the number of subprocesses
 * independent of file count and leaves no durable state behind.
 */

/**
 * Writes every snapshot file as a blob. `--no-filters` is essential: clean and
 * smudge filters would make a snap depend on the machine's Git configuration
 * rather than on the component's bytes.
 *
 * Files read from disk are still hashed in one batched call, so the subprocess
 * count stays independent of component size. Only substituted files, of which
 * there is normally one, are hashed individually from their bytes.
 */
export async function writeSnapshotBlobs(
  store: ComponentHistoryStore,
  snapshot: ComponentSnapshot
): Promise<readonly GitObjectId[]> {
  if (snapshot.files.length === 0) return [];

  const blobIds = new Array<GitObjectId | undefined>(snapshot.files.length);
  const readFromDisk: { position: number; absolutePath: string }[] = [];

  for (const [position, file] of snapshot.files.entries()) {
    if (file.content === undefined) {
      readFromDisk.push({ position, absolutePath: file.absolutePath });
      continue;
    }
    blobIds[position] = await writeBlobFromBytes(store, file.content);
  }

  if (readFromDisk.length > 0) {
    const result = await store.run({
      args: ["hash-object", "-w", "--no-filters", "--stdin-paths"],
      stdin: `${readFromDisk.map((file) => file.absolutePath).join("\n")}\n`,
    });

    const lines = result.stdout
      .toString("utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    if (lines.length !== readFromDisk.length) {
      throw new ComponentHistoryError(
        `component "${snapshot.componentId}" hashed ${lines.length} of ${readFromDisk.length} files`
      );
    }
    for (const [index, line] of lines.entries()) {
      blobIds[readFromDisk[index]!.position] = createObjectId(line, store.objectFormat);
    }
  }

  return blobIds.map((blobId, position) => {
    if (blobId === undefined) {
      throw new ComponentHistoryError(
        `component "${snapshot.componentId}" produced no blob for ${snapshot.files[position]?.path}`
      );
    }
    return blobId;
  });
}

async function writeBlobFromBytes(
  store: ComponentHistoryStore,
  content: Uint8Array
): Promise<GitObjectId> {
  const result = await store.run({
    args: ["hash-object", "-w", "--no-filters", "-t", "blob", "--stdin"],
    stdin: content,
  });
  return createObjectId(result.stdout.toString("utf8"), store.objectFormat);
}

/**
 * Builds the component tree. The tree mirrors component-relative paths with no
 * wrapper directory and no Bit Lite manifest, so the snap is exactly the set of
 * component-owned files.
 */
export async function writeSnapshotTree(
  store: ComponentHistoryStore,
  snapshot: ComponentSnapshot
): Promise<GitObjectId> {
  const blobIds = await writeSnapshotBlobs(store, snapshot);
  const indexFile = await createTemporaryIndexPath();

  try {
    if (snapshot.files.length > 0) {
      // `update-index --index-info` accepts the whole tree in one call, so the
      // subprocess count stays constant as components grow.
      const indexInfo = snapshot.files
        .map((file, position) => {
          const blobId = blobIds[position];
          if (blobId === undefined) {
            throw new ComponentHistoryError(
              `component "${snapshot.componentId}" has no blob for ${file.path}`
            );
          }
          return `${file.mode} ${blobId.hex}\t${file.path}`;
        })
        .join("\n");

      await store.run({
        args: ["update-index", "--index-info"],
        stdin: `${indexInfo}\n`,
        env: { GIT_INDEX_FILE: indexFile },
      });
    }

    const treeHex = await store.run({
      args: ["write-tree"],
      env: { GIT_INDEX_FILE: indexFile },
    });
    return createObjectId(treeHex.stdout.toString("utf8"), store.objectFormat);
  } finally {
    await rm(path.dirname(indexFile), { recursive: true, force: true });
  }
}

/** Reads the tree a commit points at, without checking anything out. */
export async function readCommitTree(
  store: ComponentHistoryStore,
  commitId: GitObjectId
): Promise<GitObjectId> {
  const result = await store.run({ args: ["rev-parse", `${commitId.hex}^{tree}`] });
  return createObjectId(result.stdout.toString("utf8"), store.objectFormat);
}

/**
 * The index is scratch state for one operation, so it lives outside the store
 * and is removed even when the operation fails.
 */
async function createTemporaryIndexPath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bit-lite-history-index-"));
  return path.join(directory, "index");
}

import { readComponentCommit, readComponentHead, type ComponentCommit } from "./commits.js";
import { ComponentHistoryError } from "./errors.js";
import { formatObjectId, type GitObjectId } from "./object-id.js";
import type { ComponentHistoryStore } from "./store.js";
import { listComponentVersionRefs } from "./tags.js";

/**
 * What: the read-only questions a caller can ask a component's history.
 *
 * Why these live in the history layer: they are all statements about the
 * store's own shape — the linear parent chain, the tag namespace, the bytes in
 * a snap's tree. What any of it *means* for a workspace is decided a layer up.
 *
 * Nothing here writes. A component with no canonical head is answered with an
 * empty history or `undefined` rather than an error, because "never recorded"
 * is one of the most useful things inspection reports and a command whose job
 * is reporting unrecorded state cannot fail on finding some.
 */

/** One snap in a component's history, with the versions assigned to it. */
export type ComponentHistoryEntry = {
  commit: ComponentCommit;
  /** Semantic versions tagged on this snap, lowest first; empty when none. */
  versions: readonly string[];
};

/**
 * Walks a component's history from its canonical head backwards along parent
 * links. Returns an empty list when the component has never been recorded.
 *
 * `limit` bounds the walk for callers showing a page of history; omitted, the
 * whole history is walked.
 */
export async function readComponentHistory(
  store: ComponentHistoryStore,
  componentId: string,
  options: { limit?: number } = {}
): Promise<ComponentHistoryEntry[]> {
  const head = await readComponentHead(store, componentId);
  if (head === undefined) return [];

  const versionsBySnap = await readVersionsBySnap(store, componentId);
  const entries: ComponentHistoryEntry[] = [];
  const seen = new Set<string>();
  let current: GitObjectId | undefined = head;

  while (current !== undefined) {
    if (options.limit !== undefined && entries.length >= options.limit) break;
    if (seen.has(current.hex)) {
      throw new ComponentHistoryError(
        `component "${componentId}" history contains a cycle at ${formatObjectId(current)}`
      );
    }
    seen.add(current.hex);

    const commit: ComponentCommit = await readComponentCommit(store, current);
    if (commit.parentIds.length > 1) {
      throw new ComponentHistoryError(
        `component "${componentId}" commit ${formatObjectId(current)} has ` +
          `${commit.parentIds.length} parents, but component history must be linear`
      );
    }
    entries.push({ commit, versions: versionsBySnap.get(commit.id.hex) ?? [] });
    current = commit.parentIds[0];
  }

  return entries;
}

/**
 * Groups a component's assigned versions by the snap they name, in one Git
 * call. Callers decorating a whole history need every tag anyway, so asking
 * per snap would be a query per entry for the same answer.
 */
export async function readVersionsBySnap(
  store: ComponentHistoryStore,
  componentId: string
): Promise<Map<string, string[]>> {
  const bySnap = new Map<string, string[]>();
  for (const ref of await listComponentVersionRefs(store, componentId)) {
    const versions = bySnap.get(ref.targetHex);
    if (versions === undefined) bySnap.set(ref.targetHex, [ref.version]);
    else versions.push(ref.version);
  }
  return bySnap;
}

/** One component-owned file's presence and identity within a tree. */
export type TreeFileEntry = {
  /** POSIX path relative to the component root. */
  path: string;
  mode: string;
  /** Hex of the blob the path resolves to. */
  blobHex: string;
};

/**
 * Lists every file a tree contains, recursively, as component-relative paths.
 * `-z` is used because a component may legitimately contain a path with a
 * newline in it, which the default format would render ambiguous.
 */
export async function readTreeFiles(
  store: ComponentHistoryStore,
  treeId: GitObjectId
): Promise<TreeFileEntry[]> {
  const result = await store.run({ args: ["ls-tree", "-r", "-z", treeId.hex] });
  const files: TreeFileEntry[] = [];

  for (const record of result.stdout.toString("utf8").split("\0")) {
    if (record.length === 0) continue;
    // `<mode> <type> <object>\t<path>`
    const tabIndex = record.indexOf("\t");
    if (tabIndex === -1) continue;
    const [mode, type, objectHex] = record.slice(0, tabIndex).split(" ");
    if (mode === undefined || type !== "blob" || objectHex === undefined) continue;
    files.push({ path: record.slice(tabIndex + 1), mode, blobHex: objectHex });
  }

  return files;
}

export type FileChangeStatus = "added" | "modified" | "deleted";

export type FileChange = {
  path: string;
  status: FileChangeStatus;
};

/**
 * Compares two trees as sets of component-relative paths. A mode change counts
 * as a modification: whether a file is executable is part of what a snap
 * records, so a component that only gained an execute bit did change.
 *
 * Either side may be `undefined`, which means "no tree" — a component that has
 * never been recorded compared against its working state, for instance. Paths
 * are returned sorted so output is stable across runs.
 */
export async function compareTrees(
  store: ComponentHistoryStore,
  before: GitObjectId | undefined,
  after: GitObjectId | undefined
): Promise<FileChange[]> {
  const beforeFiles = before === undefined ? [] : await readTreeFiles(store, before);
  const afterFiles = after === undefined ? [] : await readTreeFiles(store, after);

  const beforeByPath = new Map(beforeFiles.map((file) => [file.path, file]));
  const afterByPath = new Map(afterFiles.map((file) => [file.path, file]));
  const changes: FileChange[] = [];

  for (const [path, afterFile] of afterByPath) {
    const beforeFile = beforeByPath.get(path);
    if (beforeFile === undefined) {
      changes.push({ path, status: "added" });
      continue;
    }
    if (beforeFile.blobHex !== afterFile.blobHex || beforeFile.mode !== afterFile.mode) {
      changes.push({ path, status: "modified" });
    }
  }
  for (const path of beforeByPath.keys()) {
    if (!afterByPath.has(path)) changes.push({ path, status: "deleted" });
  }

  changes.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return changes;
}

/**
 * Reads one file's bytes out of a tree, or `undefined` when the tree does not
 * contain that path. Used to recover a snap's recorded component metadata
 * without checking anything out.
 */
export async function readTreeFile(
  store: ComponentHistoryStore,
  treeId: GitObjectId,
  filePath: string
): Promise<Buffer | undefined> {
  const result = await store.run({
    args: ["cat-file", "blob", `${treeId.hex}:${filePath}`],
    throwOnFailure: false,
  });
  if (result.exitCode !== 0) return undefined;
  return result.stdout;
}

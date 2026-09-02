import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { ComponentHistoryError } from "./errors.js";

/**
 * What: enumerates the exact set of files a component snap captures.
 *
 * Why: a snap must be reproducible from the component directory alone. The
 * walker therefore never follows a symbolic link, never leaves the component
 * root, and prunes a fixed set of generated directories rather than consulting
 * source-control ignore rules that could change what a snap means.
 */

/** Directory names pruned at any depth. Deliberately fixed for v1. */
export const prunedDirectoryNames: ReadonlySet<string> = new Set([
  ".git",
  ".bit",
  ".bit-lite",
  ".bit-lite-store.git",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

/** Git records only whether the owner-execute bit is set. */
export type ComponentFileMode = "100644" | "100755";

export type ComponentFileEntry = {
  /** POSIX path relative to the component root. */
  path: string;
  absolutePath: string;
  mode: ComponentFileMode;
  /**
   * Bytes to record instead of the file's own contents. Set only for a path
   * the caller substituted; every other entry is captured verbatim.
   */
  content?: Uint8Array;
};

export type ComponentSnapshot = {
  componentId: string;
  rootDir: string;
  /** Sorted by UTF-8 byte order so the same directory always yields the same list. */
  files: readonly ComponentFileEntry[];
};

export type ReadComponentSnapshotInput = {
  componentId: string;
  rootDir: string;
  /**
   * Component-relative POSIX paths whose recorded bytes differ from the bytes
   * on disk. A substituted path must still exist in the component, so the
   * substitution can only ever change a file's contents, never the file set.
   */
  contentOverrides?: ReadonlyMap<string, Uint8Array>;
};

export async function readComponentSnapshot(
  input: ReadComponentSnapshotInput
): Promise<ComponentSnapshot> {
  const rootDir = path.resolve(input.rootDir);
  await assertComponentRoot(input.componentId, rootDir);

  const files: ComponentFileEntry[] = [];
  await visitDirectory(input.componentId, rootDir, rootDir, files);
  files.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8"))
  );
  applyContentOverrides(input.componentId, files, input.contentOverrides);
  return { componentId: input.componentId, rootDir, files };
}

/**
 * Substitution replaces bytes only. Refusing an override for a path the walker
 * did not capture turns a stale or misspelled path into an error here rather
 * than a silently unsubstituted snap.
 */
function applyContentOverrides(
  componentId: string,
  files: ComponentFileEntry[],
  overrides: ReadonlyMap<string, Uint8Array> | undefined
): void {
  if (overrides === undefined || overrides.size === 0) return;

  const applied = new Set<string>();
  for (const file of files) {
    const content = overrides.get(file.path);
    if (content === undefined) continue;
    file.content = content;
    applied.add(file.path);
  }

  for (const path of overrides.keys()) {
    if (applied.has(path)) continue;
    throw new ComponentHistoryError(
      `component "${componentId}" has no file at ${path} to substitute`
    );
  }
}

async function assertComponentRoot(componentId: string, rootDir: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(rootDir);
  } catch (error) {
    throw new ComponentHistoryError(
      `component "${componentId}" has no directory at ${rootDir}`,
      { cause: error }
    );
  }
  if (stats.isSymbolicLink()) {
    throw new ComponentHistoryError(
      `component "${componentId}" root ${rootDir} is a symbolic link, which v1 snaps do not support`
    );
  }
  if (!stats.isDirectory()) {
    throw new ComponentHistoryError(`component "${componentId}" root ${rootDir} is not a directory`);
  }
}

async function visitDirectory(
  componentId: string,
  rootDir: string,
  directory: string,
  files: ComponentFileEntry[]
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    // Pruning happens before any other decision, and by name rather than by
    // type: `node_modules` is frequently a symbolic link in a linked workspace,
    // and a pruned name is never captured either way. This is also what keeps
    // links *beneath* a pruned directory invisible — they are never reached.
    if (prunedDirectoryNames.has(entry.name)) continue;

    const absolutePath = path.join(directory, entry.name);
    const relativePath = toPosixRelativePath(rootDir, absolutePath);

    // lstat describes the entry itself, so a link is detected before anything
    // decides whether to descend into it.
    const stats = await lstat(absolutePath);

    if (stats.isSymbolicLink()) {
      throw new ComponentHistoryError(
        `component "${componentId}" contains a symbolic link at ${relativePath}, which v1 snaps do not support`
      );
    }

    if (stats.isDirectory()) {
      await visitDirectory(componentId, rootDir, absolutePath, files);
      continue;
    }

    if (!stats.isFile()) {
      throw new ComponentHistoryError(
        `component "${componentId}" contains a non-regular file at ${relativePath}, which v1 snaps do not support`
      );
    }

    // Object creation feeds paths to Git plumbing as newline-delimited records,
    // so a newline in a file name would silently split one path into two.
    if (relativePath.includes("\n")) {
      throw new ComponentHistoryError(
        `component "${componentId}" contains a file name with a newline, which v1 snaps do not support`
      );
    }

    files.push({
      path: relativePath,
      absolutePath,
      mode: (stats.mode & 0o111) === 0 ? "100644" : "100755",
    });
  }
}

function toPosixRelativePath(rootDir: string, absolutePath: string): string {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

/**
 * What: serializes the difference between two component file sets as a unified
 * diff.
 *
 * Why hand-written rather than shelling out to `git diff --no-index`: the
 * working side's tree is deliberately never written, so handing content to Git
 * would mean writing temporary files to recover bytes already held in memory.
 * The alternative — running Git and rewriting its `---` and `+++` lines with
 * regular expressions to correct the paths — would also make the emitted format
 * a function of the local Git version.
 *
 * Two rules govern everything here. Standard output carries the patch and
 * nothing else, so that redirecting it produces a usable `*.diff` file; every
 * advisory belongs on standard error. And every line this module emits outside
 * a hunk begins with a character unified diff gives no meaning to, so a banner
 * can never be read as a file marker or a deleted line.
 */

/** Git's mode for a file that exists on neither side of a comparison. */
const absentMode = "000000";

/** Hunks carry three lines of context, as Git does by default. */
const contextLines = 3;

/**
 * Separates the component identifier from the file path. Both contain slashes,
 * so a slash cannot mark the boundary; `::` appears in neither, and it stays
 * inside the path token where no patch parser looks.
 */
const componentPathSeparator = "::";

/** One side of one file. Absent means the file does not exist on that side. */
export type PatchFileSide =
  | { kind: "absent" }
  | { kind: "present"; mode: string; blobHex: string; content: Buffer };

export type PatchFile = {
  /** POSIX path relative to the component root. */
  path: string;
  before: PatchFileSide;
  after: PatchFileSide;
};

export type PatchComponent = {
  componentId: string;
  /** What the two sides are, in the workspace's vocabulary. */
  fromLabel: string;
  toLabel: string;
  files: readonly PatchFile[];
};

/**
 * Serializes every component's differing files as one patch. Components are
 * emitted in the order given; each is preceded by a banner naming it and both
 * states, so the version transition is stated once rather than repeated on
 * every file header.
 */
export function formatPatch(components: readonly PatchComponent[]): string {
  const blocks: string[] = [];

  for (const component of components) {
    const fileBlocks = component.files
      .map((file) => formatFile(component.componentId, file))
      .filter((block) => block.length > 0);
    if (fileBlocks.length === 0) continue;
    blocks.push([formatBanner(component), ...fileBlocks].join("\n"));
  }

  // A lone `#` separates components. A blank line would read better still, but
  // an empty line is ambiguous with a context line whose content is empty, and
  // a patch should never need a parser to guess.
  return blocks.length === 0 ? "" : `${blocks.join("\n#\n")}\n`;
}

/**
 * `#` opens both lines. Unified diff has no comment syntax, but it gives `#` no
 * meaning either, so a parser skips these lines and a highlighter renders them
 * as plain text. A rule of hyphens — which is what `bit diff` uses — would
 * instead read as the old-file marker or as a deleted line.
 */
function formatBanner(component: PatchComponent): string {
  return [
    `# ${component.componentId}  ${component.fromLabel} -> ${component.toLabel}`,
    `# ${"=".repeat(60)}`,
  ].join("\n");
}

function formatFile(componentId: string, file: PatchFile): string {
  const { before, after } = file;
  if (before.kind === "absent" && after.kind === "absent") return "";

  const qualified = `${componentId}${componentPathSeparator}${file.path}`;
  const lines = [`diff --git a/${qualified} b/${qualified}`];

  const beforeMode = before.kind === "present" ? before.mode : absentMode;
  const afterMode = after.kind === "present" ? after.mode : absentMode;
  const beforeHex = before.kind === "present" ? before.blobHex : undefined;
  const afterHex = after.kind === "present" ? after.blobHex : undefined;

  if (before.kind === "absent") lines.push(`new file mode ${afterMode}`);
  else if (after.kind === "absent") lines.push(`deleted file mode ${beforeMode}`);
  else if (beforeMode !== afterMode) {
    lines.push(`old mode ${beforeMode}`, `new mode ${afterMode}`);
  }

  if (beforeHex === afterHex) {
    // Content is identical, so only the mode moved. Emitting the header alone
    // keeps the change visible: the executable bit is part of what a snap
    // records, and a patch that dropped it would understate the difference.
    return lines.join("\n");
  }

  lines.push(formatIndexLine(beforeHex, afterHex, before, after));

  const beforeContent = before.kind === "present" ? before.content : Buffer.alloc(0);
  const afterContent = after.kind === "present" ? after.content : Buffer.alloc(0);

  if (isBinary(beforeContent) || isBinary(afterContent)) {
    lines.push(`Binary files a/${qualified} and b/${qualified} differ`);
    return lines.join("\n");
  }

  lines.push(
    `--- ${before.kind === "absent" ? "/dev/null" : `a/${qualified}`}`,
    `+++ ${after.kind === "absent" ? "/dev/null" : `b/${qualified}`}`
  );
  lines.push(...formatHunks(splitLines(beforeContent), splitLines(afterContent)));

  return lines.join("\n");
}

/**
 * Both blob IDs are real. The working side's blobs are hashed by Git without
 * `-w`, so the identifier is correct even though the object was never written.
 */
function formatIndexLine(
  beforeHex: string | undefined,
  afterHex: string | undefined,
  before: PatchFileSide,
  after: PatchFileSide
): string {
  const width = (beforeHex ?? afterHex ?? "").length;
  const blank = "0".repeat(width);
  const line = `index ${beforeHex ?? blank}..${afterHex ?? blank}`;
  // Git omits the mode on the index line when it already appeared as a new,
  // deleted, or changed mode above.
  const modeUnchanged =
    before.kind === "present" && after.kind === "present" && before.mode === after.mode;
  return modeUnchanged ? `${line} ${before.mode}` : line;
}

/**
 * Content is treated as text only when it is valid UTF-8 and holds no NUL, the
 * same pair of conditions Git applies. Anything else is reported as differing
 * binary rather than rendered, because rendering it would produce lines that do
 * not correspond to anything in the file.
 */
function isBinary(content: Buffer): boolean {
  if (content.includes(0)) return true;
  const text = content.toString("utf8");
  return !Buffer.from(text, "utf8").equals(content);
}

/**
 * Splits into lines for comparison. A trailing newline terminates the last
 * line rather than opening an empty one, so a file ending in a newline and the
 * same file without one differ by exactly that line.
 */
function splitLines(content: Buffer): string[] {
  if (content.length === 0) return [];
  const text = content.toString("utf8");
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

type Edit = { kind: "equal" | "delete" | "insert"; line: string };

function formatHunks(before: readonly string[], after: readonly string[]): string[] {
  const edits = diffLines(before, after);
  const lines: string[] = [];

  let beforeLine = 1;
  let afterLine = 1;
  let index = 0;

  while (index < edits.length) {
    const change = findNextChange(edits, index);
    if (change === undefined) break;

    // Advance the line counters over the equal runs this hunk does not cover.
    for (let scan = index; scan < change; scan += 1) {
      if (edits[scan]!.kind !== "insert") beforeLine += 1;
      if (edits[scan]!.kind !== "delete") afterLine += 1;
    }

    const start = Math.max(change - contextLines, index);
    for (let scan = change - 1; scan >= start; scan -= 1) {
      if (edits[scan]!.kind !== "insert") beforeLine -= 1;
      if (edits[scan]!.kind !== "delete") afterLine -= 1;
    }

    const end = findHunkEnd(edits, change);
    const body = edits.slice(start, end);
    let beforeCount = 0;
    let afterCount = 0;
    for (const edit of body) {
      if (edit.kind !== "insert") beforeCount += 1;
      if (edit.kind !== "delete") afterCount += 1;
    }

    lines.push(
      `@@ -${formatRange(beforeLine, beforeCount)} +${formatRange(afterLine, afterCount)} @@`
    );
    for (const edit of body) {
      lines.push(`${edit.kind === "equal" ? " " : edit.kind === "delete" ? "-" : "+"}${edit.line}`);
    }

    beforeLine += beforeCount;
    afterLine += afterCount;
    index = end;
  }

  return lines;
}

/** A zero-length range is addressed at the line before it, as Git does. */
function formatRange(start: number, count: number): string {
  return count === 0 ? `${start - 1},0` : `${start},${count}`;
}

function findNextChange(edits: readonly Edit[], from: number): number | undefined {
  for (let index = from; index < edits.length; index += 1) {
    if (edits[index]!.kind !== "equal") return index;
  }
  return undefined;
}

/**
 * A hunk runs to three lines past its last change, and merges with the next
 * change when fewer than twice that many equal lines separate them — otherwise
 * the trailing and leading context would overlap.
 */
function findHunkEnd(edits: readonly Edit[], from: number): number {
  let index = from;
  let last = from;

  while (index < edits.length) {
    if (edits[index]!.kind !== "equal") {
      last = index;
      index += 1;
      continue;
    }
    let run = 0;
    while (index + run < edits.length && edits[index + run]!.kind === "equal") run += 1;
    if (run > contextLines * 2 || index + run >= edits.length) break;
    index += run;
  }

  return Math.min(last + 1 + contextLines, edits.length);
}

/**
 * Longest-common-subsequence differencing over lines. Deliberately plain: no
 * rename detection, no heuristics, no word-level refinement. The format is
 * small and fixed, which is what lets the serialized bytes be tested directly.
 */
function diffLines(before: readonly string[], after: readonly string[]): Edit[] {
  const rows = before.length;
  const columns = after.length;

  // lengths[i][j] is the LCS length of before[i..] and after[j..].
  const lengths: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(columns + 1).fill(0)
  );
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i]![j] =
        before[i] === after[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }

  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (before[i] === after[j]) {
      edits.push({ kind: "equal", line: before[i]! });
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      edits.push({ kind: "delete", line: before[i]! });
      i += 1;
    } else {
      edits.push({ kind: "insert", line: after[j]! });
      j += 1;
    }
  }
  while (i < rows) {
    edits.push({ kind: "delete", line: before[i]! });
    i += 1;
  }
  while (j < columns) {
    edits.push({ kind: "insert", line: after[j]! });
    j += 1;
  }

  return edits;
}

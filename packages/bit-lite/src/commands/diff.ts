import { readFile } from "node:fs/promises";
import path from "node:path";
import { readWorkspace, selectWorkspaceComponents } from "bit-lite-context";
import {
  abbreviateComponentVersion,
  componentTagRef,
  formatSnapVersion,
  isAncestorCommit,
  isSnapVersion,
  openRecordedHistory,
  parseSnapVersion,
  readBlobBytes,
  readCommitTree,
  readTagTarget,
  readTreeFiles,
  type ComponentHistoryStore,
  type GitObjectId,
  type TreeFileEntry,
} from "bit-lite-history";
import type { WorkspaceComponent } from "bit-lite-context";
import type { ParsedCliArgs } from "../cli/arg-types.js";
import { BitLiteError } from "bit-lite-utils";
import { readFlagOption, readTextOption } from "../cli/options.js";
import {
  componentConfigFileName,
  inspectWorkspace,
  type InspectedComponent,
} from "bit-lite-versioning";
import { formatPatch, type PatchComponent, type PatchFile } from "bit-lite-utils";

/**
 * What: emits the line-by-line content difference of the selected components
 * between two points, as a unified diff.
 *
 * Why a patch rather than a report: this command exists to be redirected.
 * `bit-lite diff > changes.diff` should produce a file editors highlight and
 * patch tools recognize, which fixes several things that would otherwise be
 * matters of taste — standard output carries the patch and nothing else, no
 * colorization, and every advisory goes to standard error.
 *
 * What this command does *not* answer is whether recording will act on a
 * component. It cannot: a component modified only because a workspace
 * prerequisite is dirty has no content difference of its own, since inspection
 * resolves that prerequisite to the version at its own head. Both sides are
 * byte-identical and the patch is necessarily empty. `status` is the authority
 * there, and where this command knows it is emitting an empty patch for such a
 * component it says so on standard error rather than pretending otherwise.
 *
 * States are named by component version, never by raw object ID: inspection
 * speaks the workspace's vocabulary, not Git's. That extends to the patch's own
 * paths, which are addressed as `a/<component-id>::<path>`.
 */

export type DiffSide =
  | { kind: "working" }
  | { kind: "snap"; version: string; snapId: string }
  | { kind: "absent" };

/** One component's place in the emitted patch. */
export type DiffComponentReport = {
  componentId: string;
  from: DiffSide;
  to: DiffSide;
  /** Component-relative paths whose content or mode differs, sorted. */
  changedPaths: readonly string[];
  /**
   * Prerequisites whose own uncommitted changes will move this component when
   * it is next recorded, though nothing in its own content differs. Only ever
   * set for a comparison involving working state.
   */
  modifiedBy: readonly string[];
};

export type DiffReport = {
  components: readonly DiffComponentReport[];
  /** The serialized patch, exactly as written to standard output. */
  patch: string;
};

export type DiffReporter = {
  report: (report: DiffReport) => void;
};

export type RunDiffCommandOptions = {
  reporter?: DiffReporter;
  /** Where advisories go. Never standard output, which carries the patch. */
  logAdvisory?: (message: string) => void;
};

export async function runDiffCommand(
  parsed: ParsedCliArgs,
  options: RunDiffCommandOptions = {}
): Promise<DiffReport> {
  const asJson = readFlagOption(parsed.args.options.json, "--json");
  const from = readTextOption(parsed.args.options.from, "--from");
  const to = readTextOption(parsed.args.options.to, "--to");
  const reporter = options.reporter ?? (asJson ? createDiffJsonReporter() : createDiffReporter());
  const logAdvisory = options.logAdvisory ?? console.error;

  const workspace = await readWorkspace(parsed.workspaceRoot);
  const components = selectComponents(workspace, parsed.componentFilters, from, to);

  const store = await openRecordedHistory(workspace.rootDir);
  if (store === undefined) {
    if (from !== undefined || to !== undefined) {
      throw new BitLiteError(
        `component "${components[0]!.id}" has no recorded history, so there is no version to compare`
      );
    }
    // Nothing has ever been recorded, so every file is an addition against
    // nothing. There is no store to read the other side from, and no patch
    // that would say anything a listing of the component root does not.
    const report: DiffReport = { components: [], patch: "" };
    reporter.report(report);
    return report;
  }

  const inspection = await inspectWorkspace(store, workspace);

  const reports: DiffComponentReport[] = [];
  const patchComponents: PatchComponent[] = [];

  for (const component of components) {
    const inspected = inspection.byComponentId.get(component.id);
    if (inspected === undefined) {
      throw new BitLiteError(`component "${component.id}" is not part of this workspace`);
    }

    const beforeSide = await resolveSide(store, component, inspected, from, "head");
    const afterSide = await resolveSide(store, component, inspected, to, "working");

    const before = await readSide(store, component, inspected, beforeSide);
    const after = await readSide(store, component, inspected, afterSide);
    const files = pairSides(before, after);

    // Only a comparison against working state can be moved by a prerequisite;
    // two recorded snaps are settled and have no such relationship.
    const involvesWorking = beforeSide.kind === "working" || afterSide.kind === "working";
    const modifiedBy =
      involvesWorking && !inspected.ownContentChanged ? inspected.changedPrerequisiteIds : [];

    reports.push({
      componentId: component.id,
      from: beforeSide,
      to: afterSide,
      changedPaths: files.map((file) => file.path),
      modifiedBy,
    });
    if (files.length > 0) {
      patchComponents.push({
        componentId: component.id,
        fromLabel: describeSide(beforeSide),
        toLabel: describeSide(afterSide),
        files,
      });
    }
  }

  const report: DiffReport = { components: reports, patch: formatPatch(patchComponents) };
  reporter.report(report);
  advise(report, logAdvisory);
  return report;
}

/**
 * A version identifier is local to one component's history, so naming versions
 * has no reading across a selection. Without them the command follows the same
 * conventions as `status`, which is what makes a whole-workspace patch useful.
 */
function selectComponents(
  workspace: Parameters<typeof selectWorkspaceComponents>[0],
  filters: readonly string[],
  from: string | undefined,
  to: string | undefined
): readonly WorkspaceComponent[] {
  const components = selectWorkspaceComponents(workspace, filters);
  if (components.length === 0) {
    throw new BitLiteError("no registered components to diff");
  }
  if ((from !== undefined || to !== undefined) && components.length > 1) {
    const ids = components.map((component) => component.id).join(", ");
    throw new BitLiteError(
      `naming a version compares one component, but the selection matched ` +
        `${components.length}: ${ids}. Narrow the selection with --filter.`
    );
  }
  return components;
}

/**
 * The empty-patch case from the command's own contract. Written to standard
 * error, so that a redirected patch stays a patch.
 */
function advise(report: DiffReport, logAdvisory: (message: string) => void): void {
  for (const component of report.components) {
    if (component.changedPaths.length > 0 || component.modifiedBy.length === 0) continue;
    logAdvisory(
      `${component.componentId}: no content differs, but ${component.modifiedBy.join(", ")} ` +
        `will move this component when recorded. Run status for what recording will act on.`
    );
  }
}

function describeSide(side: DiffSide): string {
  if (side.kind === "working") return "working";
  if (side.kind === "absent") return "never recorded";
  return abbreviateComponentVersion(side.version);
}

/**
 * Turns a user-supplied version into a side, or falls back to this side's
 * default: the recorded head on the left, working content on the right.
 */
async function resolveSide(
  store: ComponentHistoryStore,
  component: WorkspaceComponent,
  inspected: InspectedComponent,
  version: string | undefined,
  fallback: "head" | "working"
): Promise<DiffSide> {
  if (version === undefined) {
    if (fallback === "working") return { kind: "working" };
    if (inspected.head === undefined) return { kind: "absent" };
    return {
      kind: "snap",
      version: inspected.headVersion ?? formatSnapVersion(inspected.head),
      snapId: inspected.head.hex,
    };
  }

  const snapId = await resolveVersionToSnap(store, component.id, inspected, version);
  return { kind: "snap", version, snapId: snapId.hex };
}

/**
 * Resolves a component version to one of *that component's* snaps. A version
 * naming a real commit that belongs to another component's history is refused
 * as firmly as one naming nothing, because comparing across components would
 * silently produce a meaningless answer.
 */
async function resolveVersionToSnap(
  store: ComponentHistoryStore,
  componentId: string,
  inspected: InspectedComponent,
  version: string
): Promise<GitObjectId> {
  const unresolved = new BitLiteError(
    `component "${componentId}" has no version "${version}"`
  );
  if (inspected.head === undefined) throw unresolved;

  const candidate = isSnapVersion(version)
    ? parseSnapVersion(version)
    : await readTagTarget(store, componentTagRef(componentId, version));
  if (candidate === undefined) throw unresolved;

  // A component's history is linear, so reachability from its head is exactly
  // membership in that history.
  if (!(await isAncestorCommit(store, candidate, inspected.head))) throw unresolved;
  return candidate;
}

type SideContent = Map<string, { mode: string; blobHex: string; content: Buffer }>;

/**
 * Reads one side's files with their content. A recorded side comes from the
 * store by blob ID; the working side comes from the component root, because the
 * tree it belongs to was computed and never written, so the store does not hold
 * a single one of its objects.
 */
async function readSide(
  store: ComponentHistoryStore,
  component: WorkspaceComponent,
  inspected: InspectedComponent,
  side: DiffSide
): Promise<SideContent> {
  const content: SideContent = new Map();
  if (side.kind === "absent") return content;

  if (side.kind === "working") {
    for (const file of inspected.working.files) {
      content.set(file.path, {
        mode: file.mode,
        blobHex: file.blobHex,
        content: await readWorkingFile(component, file, inspected),
      });
    }
    return content;
  }

  const treeId = await readCommitTree(store, {
    algorithm: inspected.working.treeId.algorithm,
    hex: side.snapId,
  });
  for (const file of await readTreeFiles(store, treeId)) {
    content.set(file.path, {
      mode: file.mode,
      blobHex: file.blobHex,
      content: await readBlobBytes(store, file.blobHex),
    });
  }
  return content;
}

/**
 * `.comp.json` on the working side is the projection this run produced, not the
 * file on disk: the projection is what a snap would record, and comparing the
 * working file instead would report a difference on every component every time.
 */
async function readWorkingFile(
  component: WorkspaceComponent,
  file: TreeFileEntry,
  inspected: InspectedComponent
): Promise<Buffer> {
  if (file.path === componentConfigFileName) {
    return Buffer.from(inspected.working.configBytes);
  }
  return readFile(path.join(component.rootDir, file.path));
}

/**
 * Pairs the two sides by path, keeping only what differs. Identity is decided
 * by blob ID and mode, exactly as the shared comparison decides it, so the
 * patch and the reports can never disagree about which files changed.
 */
function pairSides(before: SideContent, after: SideContent): PatchFile[] {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const files: PatchFile[] = [];

  for (const filePath of paths) {
    const left = before.get(filePath);
    const right = after.get(filePath);
    if (left !== undefined && right !== undefined) {
      if (left.blobHex === right.blobHex && left.mode === right.mode) continue;
    }
    files.push({
      path: filePath,
      before: left === undefined ? { kind: "absent" } : { kind: "present", ...left },
      after: right === undefined ? { kind: "absent" } : { kind: "present", ...right },
    });
  }

  return files;
}

/**
 * The patch is written verbatim, with no trailing newline of its own added: it
 * already ends in one when it is non-empty, and an empty patch writes nothing
 * at all.
 */
export function createDiffReporter(
  write: (chunk: string) => void = (chunk) => process.stdout.write(chunk)
): DiffReporter {
  return {
    report(report) {
      if (report.patch.length > 0) write(report.patch);
    },
  };
}

/** Structured output carries complete version identifiers, never abbreviated. */
export function createDiffJsonReporter(
  log: (message: string) => void = console.log
): DiffReporter {
  return {
    report(report) {
      log(JSON.stringify(report, null, 2));
    },
  };
}

import { stat } from "node:fs/promises";
import { readWorkspace } from "bit-lite-context";
import {
  abbreviateComponentVersion,
  componentTagRef,
  formatSnapVersion,
  isAncestorCommit,
  isSnapVersion,
  openComponentHistoryStore,
  parseSnapVersion,
  readCommitTree,
  readTagTarget,
  resolveComponentStorePath,
  type ComponentHistoryStore,
  type FileChange,
  type GitObjectId,
} from "bit-lite-history";
import type { ParsedCliArgs, WorkspaceComponent } from "bit-lite-context";
import { BitLiteError } from "../utils/errors.js";
import { readFlagOption, readTextOption } from "../utils/command-options.js";
import { selectSingleWorkspaceComponent } from "../utils/command-selection.js";
import {
  compareComponentStates,
  inspectWorkspace,
  type ComparisonSide,
  type InspectedComponent,
} from "../utils/component-inspection.js";
import type { DependencyChange, EnvChange } from "../utils/component-metadata-diff.js";

/**
 * What: compares a component between two points — working state or recorded
 * versions — and says what differs.
 *
 * The default comparison reads the same two trees `snap` compares, so an empty
 * diff means the next snap reports the component unchanged. That equivalence is
 * the command's whole value: a user who sees "no changes" and then watches
 * `snap` create a commit stops trusting both commands.
 *
 * Keeping it true takes one more thing than reading the same trees. A component
 * whose dependency has uncommitted changes will get a new version when both are
 * recorded, even though nothing in its own projection has moved yet — because
 * the dependency's next version is not knowable without writing a commit. So a
 * default diff also reports the prerequisites that will move it, rather than
 * claiming a component is unchanged that `snap` is about to advance.
 *
 * States are named by component version, never by raw object ID: inspection
 * speaks the workspace's vocabulary, not Git's.
 */

export type DiffSide =
  | { kind: "working" }
  | { kind: "snap"; version: string; snapId: string }
  | { kind: "absent" };

export type DiffReport = {
  componentId: string;
  from: DiffSide;
  to: DiffSide;
  /** Component-owned files other than `.comp.json`. */
  files: readonly FileChange[];
  dependencies: readonly DependencyChange[];
  env: EnvChange | undefined;
  /** Recorded metadata differs in a way that is neither a dependency nor an env change. */
  otherMetadataChanged: boolean;
  /**
   * Prerequisites whose own uncommitted changes will move this component when
   * it is next recorded. Only ever set for a comparison involving working state.
   */
  modifiedBy: readonly string[];
  changed: boolean;
};

export type DiffReporter = {
  report: (report: DiffReport) => void;
};

export type RunDiffCommandOptions = {
  reporter?: DiffReporter;
};

export async function runDiffCommand(
  parsed: ParsedCliArgs,
  options: RunDiffCommandOptions = {}
): Promise<DiffReport> {
  const asJson = readFlagOption(parsed.args.options.json, "--json");
  const from = readTextOption(parsed.args.options.from, "--from");
  const to = readTextOption(parsed.args.options.to, "--to");
  const reporter = options.reporter ?? (asJson ? createDiffJsonReporter() : createDiffReporter());

  const workspace = await readWorkspace(parsed.workspaceRoot);
  const component = selectSingleWorkspaceComponent(workspace, parsed.componentFilters, "diff");

  if (!(await directoryExists(resolveComponentStorePath(workspace.rootDir)))) {
    if (from !== undefined || to !== undefined) {
      throw new BitLiteError(
        `component "${component.id}" has no recorded history, so there is no version to compare`
      );
    }
    const report = emptyReport(component.id, { kind: "absent" }, { kind: "working" });
    reporter.report(report);
    return report;
  }

  const store = await openComponentHistoryStore({
    workspaceRoot: workspace.rootDir,
    create: false,
  });
  const inspection = await inspectWorkspace(store, workspace);
  const inspected = inspection.byComponentId.get(component.id);
  if (inspected === undefined) {
    throw new BitLiteError(`component "${component.id}" is not part of this workspace`);
  }

  const beforeSide = await resolveSide(store, component, inspected, from, "head");
  const afterSide = await resolveSide(store, component, inspected, to, "working");

  const comparison = await compareComponentStates(
    store,
    component.id,
    await comparisonSide(store, inspected, beforeSide),
    await comparisonSide(store, inspected, afterSide)
  );

  // Only a comparison against working state can be moved by a prerequisite;
  // two recorded snaps are settled and have no such relationship.
  const involvesWorking = beforeSide.kind === "working" || afterSide.kind === "working";
  const modifiedBy =
    involvesWorking && !inspected.ownContentChanged ? inspected.changedPrerequisiteIds : [];

  const report: DiffReport = {
    componentId: component.id,
    from: beforeSide,
    to: afterSide,
    files: comparison.files,
    dependencies: comparison.metadata.dependencies,
    env: comparison.metadata.env,
    otherMetadataChanged: comparison.metadata.otherChanged,
    modifiedBy,
    changed:
      comparison.files.length > 0 ||
      comparison.metadata.dependencies.length > 0 ||
      comparison.metadata.env !== undefined ||
      comparison.metadata.otherChanged ||
      modifiedBy.length > 0,
  };
  reporter.report(report);
  return report;
}

function emptyReport(componentId: string, from: DiffSide, to: DiffSide): DiffReport {
  return {
    componentId,
    from,
    to,
    files: [],
    dependencies: [],
    env: undefined,
    otherMetadataChanged: false,
    modifiedBy: [],
    changed: false,
  };
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

/** Turns a reported side into the form the shared comparison consumes. */
async function comparisonSide(
  store: ComponentHistoryStore,
  inspected: InspectedComponent,
  side: DiffSide
): Promise<ComparisonSide> {
  if (side.kind === "absent") return { kind: "absent" };
  if (side.kind === "working") return { kind: "working", state: inspected.working };
  return {
    kind: "recorded",
    treeId: await readCommitTree(store, {
      algorithm: inspected.working.treeId.algorithm,
      hex: side.snapId,
    }),
  };
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

export function createDiffReporter(log: (message: string) => void = console.log): DiffReporter {
  return {
    report(report) {
      log(
        `${report.componentId}   ${describeSide(report.from)} -> ${describeSide(report.to)}`
      );
      if (!report.changed) {
        log("");
        log("  no changes");
        return;
      }

      if (report.files.length > 0) {
        log("");
        log("  source");
        for (const change of report.files) {
          log(`    ${fileMarker(change.status)}  ${change.path}`);
        }
      }
      if (report.dependencies.length > 0) {
        log("");
        log("  dependencies");
        for (const change of report.dependencies) {
          log(`    ${dependencyMarker(change)}  ${describeDependency(change)}`);
        }
      }
      if (report.env !== undefined) {
        log("");
        log("  env");
        log(`    ~  ${describeEnv(report.env)}`);
      }
      if (report.otherMetadataChanged) {
        log("");
        log("  metadata");
        log("    ~  component metadata changed");
      }
      if (report.modifiedBy.length > 0) {
        log("");
        log("  dependencies with uncommitted changes");
        for (const componentId of report.modifiedBy) {
          log(`    ~  ${componentId} will move this component when recorded`);
        }
      }
    },
  };
}

function describeSide(side: DiffSide): string {
  if (side.kind === "working") return "working";
  if (side.kind === "absent") return "never recorded";
  return abbreviateComponentVersion(side.version);
}

function fileMarker(status: FileChange["status"]): string {
  return status === "added" ? "A" : status === "deleted" ? "D" : "M";
}

function dependencyMarker(change: DependencyChange): string {
  return change.status === "added" ? "+" : change.status === "removed" ? "-" : "~";
}

function describeDependency(change: DependencyChange): string {
  const field = change.field === "dependencies" ? "" : ` (${change.field})`;
  if (change.status === "added") {
    return `${change.packageName}${field}   ${abbreviateComponentVersion(change.after ?? "-")}`;
  }
  if (change.status === "removed") {
    return `${change.packageName}${field}   ${abbreviateComponentVersion(change.before ?? "-")}`;
  }
  return (
    `${change.packageName}${field}   ${abbreviateComponentVersion(change.before ?? "-")} -> ` +
    `${abbreviateComponentVersion(change.after ?? "-")}`
  );
}

function describeEnv(change: EnvChange): string {
  const name = change.after?.packageName ?? change.before?.packageName ?? "-";
  return (
    `${name}   ${abbreviateComponentVersion(change.before?.version ?? "-")} -> ` +
    `${abbreviateComponentVersion(change.after?.version ?? "-")}`
  );
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

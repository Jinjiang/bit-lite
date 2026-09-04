import { stat } from "node:fs/promises";
import { readWorkspace } from "bit-lite-context";
import {
  abbreviateComponentVersion,
  formatObjectId,
  formatSnapVersion,
  openComponentHistoryStore,
  readCommitTree,
  readComponentHistory,
  resolveComponentStorePath,
  type ComponentHistoryStore,
} from "bit-lite-history";
import type { ParsedCliArgs } from "bit-lite-context";
import { readFlagOption } from "../utils/command-options.js";
import { selectSingleWorkspaceComponent } from "../utils/command-selection.js";
import { compareComponentTrees } from "../utils/component-inspection.js";
import {
  attributeSnapChange,
  type ChangeSource,
  type DependencyChange,
  type EnvChange,
} from "../utils/component-metadata-diff.js";

/**
 * What: lists one component's recorded history, saying why each version exists.
 *
 * Why attribution is the point rather than a decoration: a component gets a new
 * version when a dependency or its env moves, with nothing visible changing in
 * the working tree. That behaviour is correct, but it is only tolerable if the
 * tooling can explain it — so every entry names the dependency or env versions
 * on both sides rather than leaving the user to open the store.
 */

export type LogEntry = {
  /** The snap's own version identifier, in full. */
  snapVersion: string;
  /** Algorithm-qualified commit ID, for diagnostics. */
  snapId: string;
  authoredAt: string;
  /** Semantic versions assigned to this snap, lowest first. */
  versions: readonly string[];
  /** True for the component's first snap, which is not attributed to a change. */
  initial: boolean;
  sources: readonly ChangeSource[];
  dependencyChanges: readonly DependencyChange[];
  envChange: EnvChange | undefined;
  /** Metadata differed in a way that is neither a dependency nor an env change. */
  otherMetadataChanged: boolean;
  /** Component-owned files other than `.comp.json` that differ from the parent. */
  changedFileCount: number;
};

export type LogReport = {
  componentId: string;
  neverRecorded: boolean;
  entries: readonly LogEntry[];
};

export type LogReporter = {
  report: (report: LogReport) => void;
};

export type RunLogCommandOptions = {
  reporter?: LogReporter;
};

export async function runLogCommand(
  parsed: ParsedCliArgs,
  options: RunLogCommandOptions = {}
): Promise<LogReport> {
  const asJson = readFlagOption(parsed.args.options.json, "--json");
  const reporter = options.reporter ?? (asJson ? createLogJsonReporter() : createLogReporter());

  const workspace = await readWorkspace(parsed.workspaceRoot);
  const component = selectSingleWorkspaceComponent(workspace, parsed.componentFilters, "log");

  // No store means no history, which is an answer rather than a failure.
  if (!(await directoryExists(resolveComponentStorePath(workspace.rootDir)))) {
    const report = { componentId: component.id, neverRecorded: true, entries: [] };
    reporter.report(report);
    return report;
  }

  const store = await openComponentHistoryStore({
    workspaceRoot: workspace.rootDir,
    create: false,
  });
  const history = await readComponentHistory(store, component.id);

  const entries: LogEntry[] = [];
  for (const { commit, versions } of history) {
    const parentId = commit.parentIds[0];
    const parentTree = parentId === undefined ? undefined : await readCommitTree(store, parentId);
    const comparison = await compareComponentTrees(
      store,
      component.id,
      parentTree,
      commit.treeId
    );
    const attribution = attributeSnapChange({
      hasParent: parentId !== undefined,
      fileChanges: comparison.files,
      metadata: comparison.metadata,
    });

    entries.push({
      snapVersion: formatSnapVersion(commit.id),
      snapId: formatObjectId(commit.id),
      authoredAt: commit.authoredAt,
      versions,
      initial: attribution.initial,
      sources: attribution.sources,
      dependencyChanges: comparison.metadata.dependencies,
      envChange: comparison.metadata.env,
      otherMetadataChanged: attribution.otherMetadataChanged,
      changedFileCount: comparison.files.length,
    });
  }

  const report: LogReport = {
    componentId: component.id,
    neverRecorded: history.length === 0,
    entries,
  };
  reporter.report(report);
  return report;
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

export function createLogReporter(log: (message: string) => void = console.log): LogReporter {
  return {
    report(report) {
      if (report.neverRecorded) {
        log(`${report.componentId} has never been recorded`);
        return;
      }

      for (const entry of report.entries) {
        const decoration = entry.versions.length > 0 ? `  ${entry.versions.join(", ")}` : "";
        log(
          `${abbreviateComponentVersion(entry.snapVersion)}  ${entry.authoredAt}${decoration}`
        );
        for (const line of entryDetail(entry)) log(`  ${line}`);
      }
    },
  };
}

function entryDetail(entry: LogEntry): string[] {
  if (entry.initial) return ["initial version"];

  const lines: string[] = [];
  // "metadata" is a display label rather than a change source: it covers a
  // recorded difference this build cannot name, which must still be visible.
  const labels: string[] = [...entry.sources];
  if (entry.otherMetadataChanged) labels.push("metadata");
  lines.push(labels.length > 0 ? labels.join(", ") : "no recognized change");

  // The point of the whole command: a version with no source change says which
  // dependency or env moved instead of leaving the user to guess.
  if (entry.changedFileCount === 0 && !entry.initial) {
    lines.push("no component-owned source file changed");
  }
  for (const change of entry.dependencyChanges) {
    lines.push(
      `${change.packageName}  ${abbreviateComponentVersion(change.before ?? "-")} -> ` +
        `${abbreviateComponentVersion(change.after ?? "-")}`
    );
  }
  if (entry.envChange !== undefined) {
    const before = entry.envChange.before;
    const after = entry.envChange.after;
    lines.push(
      `env ${after?.packageName ?? before?.packageName ?? "-"}  ` +
        `${abbreviateComponentVersion(before?.version ?? "-")} -> ` +
        `${abbreviateComponentVersion(after?.version ?? "-")}`
    );
  }

  return lines;
}

/** Structured output carries complete version identifiers, never abbreviated. */
export function createLogJsonReporter(
  log: (message: string) => void = console.log
): LogReporter {
  return {
    report(report) {
      log(JSON.stringify(report, null, 2));
    },
  };
}

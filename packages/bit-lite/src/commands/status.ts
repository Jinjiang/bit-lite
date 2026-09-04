import { stat } from "node:fs/promises";
import { readWorkspace, selectWorkspaceComponents } from "bit-lite-context";
import {
  abbreviateComponentVersion,
  componentTagRef,
  isAncestorCommit,
  isSnapVersion,
  openComponentHistoryStore,
  parseSnapVersion,
  readTagTarget,
  resolveComponentStorePath,
  type ComponentHistoryStore,
  type GitObjectId,
} from "bit-lite-history";
import type { ParsedCliArgs, WorkspaceComponent } from "bit-lite-context";
import { BitLiteError } from "../utils/errors.js";
import { readFlagOption } from "../utils/command-options.js";
import {
  inspectWorkspace,
  type InspectedComponent,
  type WorkspaceInspection,
} from "../utils/component-inspection.js";
import { readRecordedComponentConfig } from "../utils/component-metadata-diff.js";

/**
 * What: reports where each selected component stands relative to the store.
 *
 * Why it reads the workspace the way `snap` does: everything reported here
 * comes from `bit-lite.json`, the component roots, and the store. Requiring
 * resolved envs would add a dependency none of those facts have, and would make
 * the command useless in a freshly cloned workspace — which is exactly where
 * "what state is any of this in" is worth asking.
 *
 * The conditions are independent on purpose. A component can be modified *and*
 * behind *and* have dependency updates, and collapsing them into one word would
 * lose the distinction between "your work is unrecorded" and "the ground moved
 * under what you recorded".
 */

export type DependencyUpdate = {
  kind: "dependency" | "env";
  packageName: string;
  /** Version the component's head recorded for this prerequisite. */
  recorded: string;
  /** Version that prerequisite carries at its own head right now. */
  current: string;
};

export type ComponentStatus = {
  componentId: string;
  /** Version at the canonical head; absent when never recorded. */
  headVersion: string | undefined;
  /** The workspace anchor, reported only when it differs from the head version. */
  anchoredVersion: string | undefined;
  neverRecorded: boolean;
  modified: boolean;
  /** Prerequisites whose own changes make this component modified. */
  modifiedBy: readonly string[];
  neverReleased: boolean;
  behind: boolean;
  dependencyUpdates: readonly DependencyUpdate[];
  clean: boolean;
};

export type StatusReport = {
  /** Absent when the workspace has no component history store. */
  storePath: string | undefined;
  components: readonly ComponentStatus[];
};

export type StatusReporter = {
  report: (report: StatusReport) => void;
};

export type RunStatusCommandOptions = {
  reporter?: StatusReporter;
};

export async function runStatusCommand(
  parsed: ParsedCliArgs,
  options: RunStatusCommandOptions = {}
): Promise<StatusReport> {
  const asJson = readFlagOption(parsed.args.options.json, "--json");
  const reporter =
    options.reporter ?? (asJson ? createStatusJsonReporter() : createStatusReporter());

  const workspace = await readWorkspace(parsed.workspaceRoot);
  const components = selectWorkspaceComponents(workspace, parsed.componentFilters);
  if (components.length === 0) {
    throw new BitLiteError("no registered components to report");
  }

  // A workspace with no store is answered without opening one, which also
  // keeps `status` usable where Git is absent entirely.
  const storePath = resolveComponentStorePath(workspace.rootDir);
  if (!(await directoryExists(storePath))) {
    const report = { storePath: undefined, components: components.map(neverRecordedStatus) };
    reporter.report(report);
    return report;
  }

  const store = await openComponentHistoryStore({
    workspaceRoot: workspace.rootDir,
    create: false,
  });
  const inspection = await inspectWorkspace(store, workspace);

  const statuses: ComponentStatus[] = [];
  for (const component of components) {
    statuses.push(await describeComponent(store, component, inspection));
  }

  const report: StatusReport = { storePath: store.gitDir, components: statuses };
  reporter.report(report);
  return report;
}

function neverRecordedStatus(component: WorkspaceComponent): ComponentStatus {
  return {
    componentId: component.id,
    headVersion: undefined,
    anchoredVersion: undefined,
    neverRecorded: true,
    modified: false,
    modifiedBy: [],
    neverReleased: false,
    behind: false,
    dependencyUpdates: [],
    clean: false,
  };
}

async function describeComponent(
  store: ComponentHistoryStore,
  component: WorkspaceComponent,
  inspection: WorkspaceInspection
): Promise<ComponentStatus> {
  const inspected = inspection.byComponentId.get(component.id);
  if (inspected === undefined || inspected.head === undefined) {
    return neverRecordedStatus(component);
  }

  const headVersion = inspected.headVersion;
  const anchor = component.version;
  const behind = await isBehind(store, component, inspected.head, anchor);
  const dependencyUpdates = await readDependencyUpdates(store, component, inspected, inspection);

  // A snap identifier in this position means no version was ever assigned to
  // the head, which is the half of `tag`'s skip rule that says there is still
  // something to release.
  const neverReleased =
    !inspected.changed && headVersion !== undefined && isSnapVersion(headVersion);

  return {
    componentId: component.id,
    headVersion,
    anchoredVersion: anchor === headVersion ? undefined : anchor,
    neverRecorded: false,
    modified: inspected.changed,
    modifiedBy: inspected.ownContentChanged ? [] : inspected.changedPrerequisiteIds,
    neverReleased,
    behind,
    dependencyUpdates,
    clean:
      !inspected.changed && !neverReleased && !behind && dependencyUpdates.length === 0,
  };
}

/**
 * The anchor lags the head. This is what synchronization creates: it
 * fast-forwards a canonical head without touching working files, leaving the
 * working tree based on an ancestor of the head it would be recorded against.
 *
 * An anchor holds either spelling a recording command can write — a snap
 * identifier after `snap`, a semantic version naming a tag after `tag` — so
 * both are resolved. An anchor that resolves to nothing is not reported as
 * behind: that is a damaged workspace rather than a stale one, and inventing an
 * ancestry answer for it would be worse than saying nothing.
 */
async function isBehind(
  store: ComponentHistoryStore,
  component: WorkspaceComponent,
  head: GitObjectId,
  anchor: string | undefined
): Promise<boolean> {
  if (anchor === undefined) return false;

  const anchored = await resolveAnchor(store, component.id, anchor, head.algorithm);
  if (anchored === undefined || anchored.hex === head.hex) return false;
  return isAncestorCommit(store, anchored, head);
}

async function resolveAnchor(
  store: ComponentHistoryStore,
  componentId: string,
  anchor: string,
  algorithm: GitObjectId["algorithm"]
): Promise<GitObjectId | undefined> {
  const snapId = parseSnapVersion(anchor);
  if (snapId !== undefined) {
    return snapId.algorithm === algorithm ? snapId : undefined;
  }
  return readTagTarget(store, componentTagRef(componentId, anchor));
}

/**
 * Compares what the head recorded for each workspace prerequisite against what
 * that prerequisite carries now. Read from history rather than from the
 * workspace, because the working `.comp.json` says `workspace:*` — the version
 * a component was last recorded against exists only inside its head commit.
 */
async function readDependencyUpdates(
  store: ComponentHistoryStore,
  component: WorkspaceComponent,
  inspected: InspectedComponent,
  inspection: WorkspaceInspection
): Promise<DependencyUpdate[]> {
  if (inspected.headTreeId === undefined) return [];
  const recorded = await readRecordedComponentConfig(store, component.id, inspected.headTreeId);
  if (recorded === undefined) return [];

  const updates: DependencyUpdate[] = [];

  for (const packageName of component.internalDependencyPackageNames) {
    const recordedVersion = findRecordedDependency(recorded, packageName);
    const current = inspection.versionByPackageName.get(packageName);
    if (recordedVersion === undefined || current === undefined) continue;
    if (recordedVersion !== current) {
      updates.push({ kind: "dependency", packageName, recorded: recordedVersion, current });
    }
  }

  const envPackageName = component.internalEnvPackageName;
  if (envPackageName !== undefined) {
    const recordedEnv = readRecordedEnvVersion(recorded);
    const current = inspection.versionByPackageName.get(envPackageName);
    if (recordedEnv !== undefined && current !== undefined && recordedEnv !== current) {
      updates.push({
        kind: "env",
        packageName: envPackageName,
        recorded: recordedEnv,
        current,
      });
    }
  }

  return updates;
}

function findRecordedDependency(
  recorded: Record<string, unknown>,
  packageName: string
): string | undefined {
  for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const declared = recorded[field];
    if (declared === null || typeof declared !== "object") continue;
    const version = (declared as Record<string, unknown>)[packageName];
    if (typeof version === "string") return version;
  }
  return undefined;
}

function readRecordedEnvVersion(recorded: Record<string, unknown>): string | undefined {
  const env = recorded.env;
  if (env === null || typeof env !== "object") return undefined;
  const version = (env as Record<string, unknown>).version;
  return typeof version === "string" ? version : undefined;
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

export function createStatusReporter(
  log: (message: string) => void = console.log
): StatusReporter {
  return {
    report(report) {
      for (const status of report.components) {
        log(`${status.componentId} ${describeVersion(status)} ${describeConditions(status)}`);
        for (const line of detailLines(status)) log(`  ${line}`);
      }
    },
  };
}

function describeVersion(status: ComponentStatus): string {
  if (status.headVersion === undefined) return "-";
  const head = abbreviateComponentVersion(status.headVersion);
  if (status.anchoredVersion === undefined) return head;
  return `${head} (anchored ${abbreviateComponentVersion(status.anchoredVersion)})`;
}

function describeConditions(status: ComponentStatus): string {
  if (status.clean) return "clean";

  const conditions: string[] = [];
  if (status.neverRecorded) conditions.push("never recorded");
  if (status.modified) conditions.push("modified");
  if (status.neverReleased) conditions.push("never released");
  if (status.behind) conditions.push("behind");
  if (status.dependencyUpdates.length > 0) conditions.push("dependency updates available");
  return conditions.join(", ");
}

/**
 * The conditions that are only actionable once the versions involved are
 * named. "Behind" also says what recording would do, because there is no
 * `checkout` to recover with and implying one would be worse than saying
 * nothing.
 */
function detailLines(status: ComponentStatus): string[] {
  const lines: string[] = [];

  if (status.modifiedBy.length > 0) {
    lines.push(`modified by ${status.modifiedBy.join(", ")}`);
  }
  if (status.behind) {
    lines.push(
      `anchored at ${abbreviateComponentVersion(status.anchoredVersion ?? "")}, ` +
        `head is ${abbreviateComponentVersion(status.headVersion ?? "")}; ` +
        "recording from here would record content based on the older version"
    );
  }
  for (const update of status.dependencyUpdates) {
    lines.push(
      `${update.kind} ${update.packageName} ` +
        `${abbreviateComponentVersion(update.recorded)} -> ` +
        `${abbreviateComponentVersion(update.current)}`
    );
  }

  return lines;
}

/** Structured output carries complete version identifiers, never abbreviated. */
export function createStatusJsonReporter(
  log: (message: string) => void = console.log
): StatusReporter {
  return {
    report(report) {
      log(
        JSON.stringify(
          { storePath: report.storePath ?? null, components: report.components },
          null,
          2
        )
      );
    },
  };
}

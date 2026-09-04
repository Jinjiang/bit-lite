import {
  getComponentPrerequisitePackageNames,
  orderComponentsByPrerequisites,
} from "bit-lite-context";
import {
  compareFileLists,
  computeSnapshotBlobs,
  computeSnapshotTreeId,
  formatSnapVersion,
  objectIdsEqual,
  readCommitTree,
  readComponentHead,
  readComponentSnapshot,
  readTreeFiles,
  readVersionAtSnap,
  type ComponentHistoryStore,
  type FileChange,
  type GitObjectId,
  type TreeFileEntry,
} from "bit-lite-history";
import type { Workspace, WorkspaceComponent } from "bit-lite-context";
import { BitLiteError } from "./errors.js";
import {
  componentConfigFileName,
  projectComponentConfigBytes,
  type ComponentVersionLookup,
} from "./component-projection.js";
import {
  compareComponentMetadata,
  readRecordedComponentConfig,
  type MetadataComparison,
} from "./component-metadata-diff.js";

/**
 * What: works out, for every component in a workspace, what its current state
 * is relative to what the store has recorded — writing nothing.
 *
 * Two decisions shape everything here.
 *
 * First, a dependency's version is read from that dependency's own canonical
 * head, never from what recording *would* assign it. Recording resolves a
 * modified dependency to the snap it is about to create, and that value is
 * doubly unavailable to a read-only command: producing it writes a commit, and
 * a commit ID folds in the author timestamp, so it is not even reproducible.
 *
 * Second, and because of the first, modification propagates. A component whose
 * dependency has uncommitted changes will get a new version when both are
 * recorded, since the dependency's fresh commit carries no tag and its version
 * string therefore always changes. Propagating gives the same answer recording
 * would, without predicting any identifier — which is what keeps inspection
 * and recording from ever disagreeing about whether a component changed.
 *
 * Unlike recording, nothing here refuses. A prerequisite that has never been
 * recorded or has uncommitted changes is reported, not rejected: a command
 * whose whole job is describing unrecorded state cannot fail on finding some.
 */

/**
 * Stands in for a prerequisite that has never been recorded, matching what
 * linking writes for the same situation. It only ever reaches a projection
 * whose component is already reported as changed, because an unrecorded
 * prerequisite propagates, so it can never decide a reported answer.
 */
export const unrecordedComponentVersion = "0.0.0";

/**
 * A component's working content as it would be recorded. The entry list is
 * carried rather than only the tree ID because the tree was computed and never
 * written: Git can compare IDs for equality, but it cannot list the contents of
 * an object the store does not hold, so any comparison against working state
 * has to work from entries.
 */
export type ComponentWorkingState = {
  treeId: GitObjectId;
  files: readonly TreeFileEntry[];
  /** The projected `.comp.json` these files would record. */
  configBytes: Uint8Array;
};

export type InspectedComponent = {
  component: WorkspaceComponent;
  /** The component's canonical head, or `undefined` when never recorded. */
  head: GitObjectId | undefined;
  /** Version the head carries: its assigned semantic version, else its snap identifier. */
  headVersion: string | undefined;
  headTreeId: GitObjectId | undefined;
  working: ComponentWorkingState;
  /** The component's own content differs from its head, or it has no head. */
  ownContentChanged: boolean;
  /** `ownContentChanged`, or some prerequisite changed. What recording will act on. */
  changed: boolean;
  /** Direct prerequisites that are themselves changed, named for diagnostics. */
  changedPrerequisiteIds: readonly string[];
};

export type WorkspaceInspection = {
  byComponentId: ReadonlyMap<string, InspectedComponent>;
  /** What each workspace package currently carries, by its own head. */
  versionByPackageName: ReadonlyMap<string, string>;
};

/**
 * Inspects every component in the workspace, not only a selected subset:
 * propagation needs a prerequisite's state even when the user filtered it out
 * of the report.
 */
export async function inspectWorkspace(
  store: ComponentHistoryStore,
  workspace: Workspace
): Promise<WorkspaceInspection> {
  const heads = new Map<string, GitObjectId | undefined>();
  const headVersions = new Map<string, string | undefined>();
  const versionByPackageName = new Map<string, string>();

  for (const component of workspace.components) {
    const head = await readComponentHead(store, component.id);
    const version =
      head === undefined
        ? undefined
        : ((await readVersionAtSnap(store, component.id, head.hex)) ?? formatSnapVersion(head));
    heads.set(component.id, head);
    headVersions.set(component.id, version);
    versionByPackageName.set(component.packageName, version ?? unrecordedComponentVersion);
  }

  const resolveVersion: ComponentVersionLookup = (packageName) =>
    versionByPackageName.get(packageName);
  const byPackageName = new Map(
    workspace.components.map((component) => [component.packageName, component])
  );
  const byComponentId = new Map<string, InspectedComponent>();

  // Prerequisite order, so a component's prerequisites are already decided by
  // the time propagation reads them. That is what makes propagation transitive
  // without a second traversal.
  for (const component of orderComponentsByPrerequisites(workspace)) {
    const head = heads.get(component.id);
    const headTreeId = head === undefined ? undefined : await readCommitTree(store, head);
    const working = await computeProjectedWorkingState(store, component, resolveVersion);
    const ownContentChanged =
      headTreeId === undefined || !objectIdsEqual(headTreeId, working.treeId);

    const changedPrerequisiteIds: string[] = [];
    for (const prerequisiteName of getComponentPrerequisitePackageNames(component)) {
      const prerequisite = byPackageName.get(prerequisiteName);
      if (prerequisite === undefined) continue;
      if (byComponentId.get(prerequisite.id)?.changed === true) {
        changedPrerequisiteIds.push(prerequisite.id);
      }
    }

    byComponentId.set(component.id, {
      component,
      head,
      headVersion: headVersions.get(component.id),
      headTreeId,
      working,
      ownContentChanged,
      changed: ownContentChanged || changedPrerequisiteIds.length > 0,
      changedPrerequisiteIds,
    });
  }

  return { byComponentId, versionByPackageName };
}

/**
 * What a component's working directory would record right now. Projected
 * first, so working state and recorded state are never compared in different
 * shapes.
 */
export async function computeProjectedWorkingState(
  store: ComponentHistoryStore,
  component: WorkspaceComponent,
  resolveVersion: ComponentVersionLookup
): Promise<ComponentWorkingState> {
  const configBytes = await projectComponentConfigBytes({ component, resolveVersion });
  const snapshot = await readComponentSnapshot({
    componentId: component.id,
    rootDir: component.rootDir,
    contentOverrides: new Map([[componentConfigFileName, configBytes]]),
  });

  const blobIds = await computeSnapshotBlobs(store, snapshot);
  return {
    treeId: computeSnapshotTreeId(snapshot, blobIds, store.objectFormat),
    files: snapshot.files.map((file, position) => ({
      path: file.path,
      mode: file.mode,
      blobHex: blobIds[position]!.hex,
    })),
    configBytes,
  };
}

/** One end of a comparison: nothing, a recorded snap's tree, or working state. */
export type ComparisonSide =
  | { kind: "absent" }
  | { kind: "recorded"; treeId: GitObjectId }
  | { kind: "working"; state: ComponentWorkingState };

export type ComponentComparison = {
  /** Component-owned files other than `.comp.json`. */
  files: readonly FileChange[];
  metadata: MetadataComparison;
};

/**
 * The one comparison `status`, `log`, and `diff` all read.
 *
 * `.comp.json` is lifted out of the file list and expressed through the
 * metadata comparison instead: it is a projection rather than a file anyone
 * can open, so listing it as changed would say nothing useful.
 */
export async function compareComponentStates(
  store: ComponentHistoryStore,
  componentId: string,
  before: ComparisonSide,
  after: ComparisonSide
): Promise<ComponentComparison> {
  const beforeContent = await readSide(store, componentId, before);
  const afterContent = await readSide(store, componentId, after);

  return {
    files: compareFileLists(beforeContent.files, afterContent.files).filter(
      (change) => change.path !== componentConfigFileName
    ),
    metadata: compareComponentMetadata(beforeContent.config, afterContent.config),
  };
}

async function readSide(
  store: ComponentHistoryStore,
  componentId: string,
  side: ComparisonSide
): Promise<{
  files: readonly TreeFileEntry[];
  config: Record<string, unknown> | undefined;
}> {
  if (side.kind === "absent") return { files: [], config: undefined };
  if (side.kind === "working") {
    return {
      files: side.state.files,
      config: parseProjectedConfig(componentId, side.state.configBytes),
    };
  }
  return {
    files: await readTreeFiles(store, side.treeId),
    config: await readRecordedComponentConfig(store, componentId, side.treeId),
  };
}

/**
 * The working side's metadata is the projection this run just produced, so it
 * is read from those bytes rather than from the store — the tree they belong to
 * was never written.
 */
function parseProjectedConfig(
  componentId: string,
  configBytes: Uint8Array
): Record<string, unknown> | undefined {
  const parsed: unknown = JSON.parse(Buffer.from(configBytes).toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BitLiteError(
      `component "${componentId}" projected a ${componentConfigFileName} that is not an object`
    );
  }
  return parsed as Record<string, unknown>;
}

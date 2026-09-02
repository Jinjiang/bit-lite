import {
  getComponentPrerequisitePackageNames,
  orderComponentsByPrerequisites,
  writeComponentVersions,
} from "bit-lite-context";
import {
  formatSnapVersion,
  prepareComponentSnap,
  readComponentHead,
  readVersionAtSnap,
  type ComponentHistoryStore,
  type GitObjectId,
  type PreparedComponentSnap,
} from "bit-lite-history";
import type { Workspace, WorkspaceComponent } from "bit-lite-context";
import { BitLiteError } from "./errors.js";
import { componentConfigFileName, projectComponentConfigBytes } from "./component-projection.js";

/**
 * What: drives one recording operation in dependency order, resolving each
 * component's workspace versions from the components recorded before it.
 *
 * Why it lives here rather than in the history layer: ordering, env edges, and
 * the policy for a prerequisite left out of the selection are all workspace
 * facts. The history layer stays a store that records what it is handed.
 *
 * Objects are prepared for every component before any ref moves, and version
 * anchors are written only after publication, so a failure anywhere leaves
 * both the store and the workspace exactly as they were.
 */

export type PreparedRecording = {
  /** Selected components in the order they were prepared. */
  components: readonly WorkspaceComponent[];
  prepared: readonly PreparedComponentSnap[];
  /** Version each recorded component will carry, keyed by component id. */
  versionsByComponentId: ReadonlyMap<string, string>;
};

/**
 * How an operation names versions. `snap` labels a component with the snap it
 * just produced; `tag` labels it with a semantic version derived beforehand.
 * A component's own version never feeds its own projection — only its
 * dependencies' versions do — so both can share one traversal.
 */
export type RecordingPolicy = {
  /** The version the selected component will carry, decided after preparation. */
  assignVersion: (
    component: WorkspaceComponent,
    prepared: PreparedComponentSnap
  ) => string | Promise<string>;
  /** The version a prerequisite outside the selection already carries. */
  resolveExistingVersion: (
    component: WorkspaceComponent,
    head: GitObjectId
  ) => string | Promise<string>;
  /** Rejects a selected component the operation cannot handle, before any work. */
  assertSelectable?: (
    component: WorkspaceComponent,
    head: GitObjectId | undefined
  ) => void | Promise<void>;
};

export type PrepareRecordingInput = {
  store: ComponentHistoryStore;
  workspace: Workspace;
  selected: readonly WorkspaceComponent[];
  policy?: RecordingPolicy;
  /** Replaces the generated commit message on every component recorded here. */
  message?: string;
};

/**
 * Labels each component with the version its snap carries.
 *
 * One rule answers "what version is this component at" for both commands: the
 * semantic version assigned to the snap when it has one, and otherwise the snap
 * identifier. Answering it differently per command would make `snap` and `tag`
 * disagree — a `snap` run after a `tag` would rewrite every dependent's
 * recorded dependency versions from semantic versions back to snap
 * identifiers, producing new versions for components nothing changed in.
 */
export function createSnapPolicy(store: ComponentHistoryStore): RecordingPolicy {
  const versionAt = async (component: WorkspaceComponent, snapId: GitObjectId) =>
    (await readVersionAtSnap(store, component.id, snapId.hex)) ?? formatSnapVersion(snapId);

  return {
    assignVersion: (component, prepared) => versionAt(component, prepared.snapId),
    resolveExistingVersion: versionAt,
  };
}

export async function prepareRecording(
  input: PrepareRecordingInput
): Promise<PreparedRecording> {
  const { store, workspace, selected } = input;
  const policy = input.policy ?? createSnapPolicy(store);
  const byPackageName = new Map(
    workspace.components.map((component) => [component.packageName, component])
  );
  const selectedPackageNames = new Set(selected.map((component) => component.packageName));
  const { closure, requiredBy } = collectPrerequisiteClosure(selected, byPackageName);

  // Versions settled so far in this run, plus the heads of prerequisites left
  // out of the selection. Never the on-disk anchors: those are a mirror that
  // goes stale as soon as sync fast-forwards a head.
  const versionsByPackageName = new Map<string, string>();
  const resolveVersion = (packageName: string) => versionsByPackageName.get(packageName);

  const components: WorkspaceComponent[] = [];
  const prepared: PreparedComponentSnap[] = [];
  const versionsByComponentId = new Map<string, string>();

  for (const component of orderComponentsByPrerequisites(workspace, closure)) {
    if (!selectedPackageNames.has(component.packageName)) {
      versionsByPackageName.set(
        component.packageName,
        await resolveUnselectedPrerequisite(store, component, requiredBy, resolveVersion, policy)
      );
      continue;
    }

    if (policy.assertSelectable) {
      const head = await readComponentHead(store, component.id);
      await policy.assertSelectable(component, head);
    }

    const contentOverrides = new Map([
      [componentConfigFileName, await projectComponentConfigBytes({ component, resolveVersion })],
    ]);
    const snap = await prepareComponentSnap(store, {
      componentId: component.id,
      rootDir: component.rootDir,
      contentOverrides,
      ...(input.message === undefined ? {} : { message: input.message }),
    });

    const version = await policy.assignVersion(component, snap);
    versionsByPackageName.set(component.packageName, version);
    versionsByComponentId.set(component.id, version);
    components.push(component);
    prepared.push(snap);
  }

  return { components, prepared, versionsByComponentId };
}

/** Anchors are a mirror of the refs, so they are written only once refs moved. */
export async function writeRecordedVersions(
  workspace: Workspace,
  versionsByComponentId: ReadonlyMap<string, string>
): Promise<void> {
  await writeComponentVersions(workspace.rootDir, versionsByComponentId);
}

/**
 * A prerequisite the user did not select may only contribute a version when the
 * code on disk is the code its head records. Anything else would produce a
 * snapshot naming a combination that was never assembled: the selected
 * component was compiled and tested against this component's working code,
 * while the record would name a different version of it. Component versions
 * are immutable, so that record could never be withdrawn.
 */
async function resolveUnselectedPrerequisite(
  store: ComponentHistoryStore,
  component: WorkspaceComponent,
  requiredBy: ReadonlyMap<string, WorkspaceComponent>,
  resolveVersion: (packageName: string) => string | undefined,
  policy: RecordingPolicy
): Promise<string> {
  const dependent = requiredBy.get(component.packageName);
  const suggestion = dependent
    ? ` Add it to the selection, for example: --filter ${dependent.id} --filter ${component.id}.`
    : "";
  const because = dependent ? `, which "${dependent.id}" depends on,` : "";

  const head = await readComponentHead(store, component.id);
  if (head === undefined) {
    throw new BitLiteError(
      `component "${component.id}"${because} has never been snapped, so it has no version to record.${suggestion}`
    );
  }

  const contentOverrides = new Map([
    [componentConfigFileName, await projectComponentConfigBytes({ component, resolveVersion })],
  ]);
  const snap = await prepareComponentSnap(store, {
    componentId: component.id,
    rootDir: component.rootDir,
    contentOverrides,
  });

  if (snap.commitId !== undefined) {
    throw new BitLiteError(
      `component "${component.id}"${because} has uncommitted changes, so recording would reference ` +
        `${component.packageName}@${formatSnapVersion(head)}, which is not the code on disk.${suggestion}`
    );
  }
  return policy.resolveExistingVersion(component, head);
}

/**
 * Expands a selection to everything it transitively depends on. Prerequisites
 * are included so their versions can be resolved and validated, not so they can
 * be recorded; only the original selection is ever recorded.
 */
function collectPrerequisiteClosure(
  selected: readonly WorkspaceComponent[],
  byPackageName: ReadonlyMap<string, WorkspaceComponent>
): {
  closure: WorkspaceComponent[];
  requiredBy: ReadonlyMap<string, WorkspaceComponent>;
} {
  const closure = new Map<string, WorkspaceComponent>();
  const requiredBy = new Map<string, WorkspaceComponent>();
  const queue = [...selected];

  while (queue.length > 0) {
    const component = queue.shift()!;
    if (closure.has(component.packageName)) continue;
    closure.set(component.packageName, component);

    for (const prerequisiteName of getComponentPrerequisitePackageNames(component)) {
      const prerequisite = byPackageName.get(prerequisiteName);
      if (!prerequisite) {
        throw new BitLiteError(
          `component "${component.id}" depends on "${prerequisiteName}" but no such component exists`
        );
      }
      // The first component to require it gives the clearest diagnostic, and a
      // selected dependent is more useful than an intermediate one.
      if (!requiredBy.has(prerequisiteName)) requiredBy.set(prerequisiteName, component);
      queue.push(prerequisite);
    }
  }

  return { closure: [...closure.values()], requiredBy };
}

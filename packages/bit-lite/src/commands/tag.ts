import { readWorkspace, selectWorkspaceComponents } from "bit-lite-context";
import type { Workspace, WorkspaceComponent } from "bit-lite-context";
import type { ParsedCliArgs } from "../cli-args-types.js";
import {
  abbreviateComponentVersion,
  assertComponentVersion,
  deriveNextComponentVersion,
  formatSnapVersion,
  listComponentVersions,
  openComponentHistoryStore,
  publishComponentSnaps,
  readComponentCommit,
  readVersionAtSnap,
  tagComponent,
  type ComponentHistoryStore,
  type ComponentTagResult,
  type PreparedComponentSnap,
} from "bit-lite-history";
import { BitLiteError, countOf } from "bit-lite-utils";
import { selectVersions, type SelectionInputStream } from "./tag-selection.js";
import { readFlagOption, readTextOption } from "../utils/command-options.js";
import {
  applyVersionExclusions,
  assertVersionDecisions,
  attributeSnapChange,
  compareComponentStates,
  decisionExplicitVersion,
  decisionIncrement,
  decisionNamesVersion,
  noVersionDecisions,
  prepareRecording,
  writeRecordedVersions,
  type ChangeSource,
  type DependencyChange,
  type EnvChange,
  type PreparedRecording,
  type RecordingPolicy,
  type VersionDecisions,
} from "bit-lite-versioning";

/**
 * What: assigns semantic versions to the selected components' snaps.
 *
 * Why it looks like `snap`: a release usually covers several components, and
 * they do not share a version number. Tagging therefore selects components the
 * way every other workspace command does and derives a version per component,
 * incrementing the patch of the highest version that component already carries.
 *
 * Ordering is what makes the recorded metadata correct. Tagging a dependency
 * and its dependent together settles the dependency's semantic version first,
 * so the dependent records `lib.math@0.2.1` rather than a snap identifier. When
 * that changes the dependent's content, a snap is created to carry it before
 * the tag is applied; when nothing changed, the tag names the existing snap.
 */

export type TagReporter = {
  report: (report: TagReport) => void;
};

/**
 * Why a component is in the release, in the vocabulary `status` and `log`
 * already use. Defining a second one here would let the picker and `status`
 * describe the same workspace differently.
 */
export type TagReason = {
  /**
   * Nothing changed, but the head carries no assigned version. `tag` refuses a
   * component with no snap at all, so this is the only "has never been
   * released" case a plan can contain.
   */
  neverReleased: boolean;
  /** Empty when nothing about the component is new. */
  sources: readonly ChangeSource[];
  /** Dependencies whose recorded version differs, naming both sides. */
  dependencies: readonly DependencyChange[];
  /** Set when the recorded env reference differs. */
  env: EnvChange | undefined;
  /** Metadata differs in a way that is neither a dependency nor an env change. */
  otherMetadataChanged: boolean;
};

/** What a component would receive, known before anything is written. */
export type TagPlanEntry = {
  componentId: string;
  /** The version the component carries now; absent before its first release. */
  currentVersion: string | undefined;
  /** The version it would receive, or the one it keeps when skipped. */
  version: string;
  /** `skip` when nothing about the component is new; it keeps the version shown. */
  action: "tag" | "skip";
  /** Whether tagging must create a snap because the projection changed content. */
  createsSnap: boolean;
  reason: TagReason;
};

export type TagReport = {
  storePath: string;
  /** When true nothing was published: the report describes what would happen. */
  dryRun: boolean;
  /** Always populated; on a dry run it is the only account of the operation. */
  planned: readonly TagPlanEntry[];
  /** Empty on a dry run, because no tag was created. */
  tags: readonly ComponentTagResult[];
  /** Set when an interactive selection was abandoned; nothing was written. */
  cancelled?: boolean;
};

export type RunTagCommandOptions = {
  reporter?: TagReporter;
  /** Injected by tests so the selection can be driven without a terminal. */
  stdin?: SelectionInputStream;
  stdout?: NodeJS.WriteStream;
  /**
   * Per-component version choices. The interactive selection produces these;
   * a test constructs them directly, which is the point of keeping the choice
   * a value rather than something only a terminal can express.
   */
  decisions?: VersionDecisions;
};

export async function runTagCommand(
  parsed: ParsedCliArgs,
  options: RunTagCommandOptions = {}
): Promise<TagReport> {
  const dryRun = readFlagOption(parsed.args.options["dry-run"], "--dry-run");
  const asJson = readFlagOption(parsed.args.options.json, "--json");
  const interactive = readFlagOption(parsed.args.options.interactive, "--interactive");
  // Validated before the store is opened, so a bad version fails immediately.
  const requested = readTextOption(parsed.args.options.version, "--version");
  const requestedVersion = requested === undefined ? undefined : assertComponentVersion(requested);
  const message = readTextOption(parsed.args.options.message, "--message");
  const reporter = options.reporter ?? (asJson ? createTagJsonReporter() : createTagReporter());

  // Refused before any component is prepared: --json exists for a consuming
  // program, and a program cannot answer the selection; --version states the
  // answer the selection exists to ask for.
  if (interactive && asJson) {
    throw new BitLiteError(
      "--interactive and --json cannot be combined: --json emits a result for another program to read, " +
        "and the selection needs a person to answer it."
    );
  }
  if (interactive && parsed.args.options.version !== undefined) {
    throw new BitLiteError(
      "--interactive and --version cannot be combined: --version states the version, " +
        "and the selection is how you choose one."
    );
  }
  if (interactive) assertInteractiveTerminal(options);

  // Validated before the store is opened, so a bad choice fails immediately.
  const choices = assertVersionDecisions(options.decisions ?? noVersionDecisions);

  const workspace = await readWorkspace(parsed.workspaceRoot);
  const selected = selectWorkspaceComponents(workspace, parsed.componentFilters);
  if (selected.length === 0) {
    throw new BitLiteError("no registered components to tag");
  }
  // Excluded components leave the selection entirely, so their heads never move.
  const components = applyVersionExclusions(selected, choices);
  if (components.length === 0) {
    throw new BitLiteError("every selected component was excluded, so there is nothing to tag");
  }
  if (requestedVersion !== undefined && components.length !== 1) {
    const ids = components.map((component) => component.id).join(", ");
    throw new BitLiteError(
      `--version applies to exactly one component, but the selection matched ${components.length}: ${ids}. ` +
        "Narrow the selection with --filter, or omit --version to derive a version for each component."
    );
  }

  const plan = (decisions: VersionDecisions) =>
    planTagRelease({
      workspace,
      components: applyVersionExclusions(selected, decisions),
      requestedVersion,
      choices: decisions,
      ...(message === undefined ? {} : { message }),
    });

  let release = await planTagRelease({
    workspace,
    components,
    requestedVersion,
    choices,
    ...(message === undefined ? {} : { message }),
  });

  if (interactive) {
    // Nothing to decide is reported rather than presented: an interface whose
    // every row says "nothing new" asks the user to confirm a no-op.
    if (release.entries.every((entry) => entry.action === "skip")) {
      const report: TagReport = {
        storePath: release.store.gitDir,
        dryRun,
        planned: release.entries,
        tags: [],
      };
      reporter.report(report);
      return report;
    }

    const outcome = await selectVersions({
      components: selected,
      initial: release,
      replan: plan,
      ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
      ...(options.stdout === undefined ? {} : { stdout: options.stdout }),
    });

    if (outcome.kind === "cancelled") {
      const report: TagReport = {
        storePath: release.store.gitDir,
        dryRun,
        planned: [],
        tags: [],
        cancelled: true,
      };
      reporter.report(report);
      return report;
    }

    // Re-planned and compared, because files can move while a review is open.
    const approved = outcome.release.fingerprint;
    release = await plan(outcome.decisions);
    assertTagReleaseApproved(approved, release);
  }

  // A dry run is the plan phase alone: nothing distinguishes it beyond not
  // carrying the plan out, which is what makes it the rehearsal an interactive
  // selection needs.
  const tags = dryRun ? [] : await executeTagRelease(release, message);

  const report: TagReport = {
    storePath: release.store.gitDir,
    dryRun,
    planned: release.entries,
    tags,
  };
  reporter.report(report);
  return report;
}

/**
 * A command that writes immutable history must never quietly assign versions
 * the user was meant to choose, so a missing terminal is an error rather than a
 * fallback to the derived default.
 */
function assertInteractiveTerminal(options: RunTagCommandOptions): void {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  if (stdin.isTTY === true && stdout.isTTY === true) return;

  throw new BitLiteError(
    "--interactive needs an interactive terminal, but input or output is not one. " +
      "Omit --interactive to derive a patch increment for every component."
  );
}

/**
 * A computed release: what would happen, and everything needed to carry it out.
 *
 * Separating this from execution is what gives an interactive selection a
 * moment to present: the plan exists in full, with every object prepared and
 * unreachable, before any ref has moved.
 */
export type TagRelease = {
  store: ComponentHistoryStore;
  workspace: Workspace;
  recording: PreparedRecording;
  entries: readonly TagPlanEntry[];
  /**
   * Identifies what this plan would do. A review can take as long as the user
   * likes, and files can change underneath it, so the plan that was approved
   * has to be comparable with the plan that would actually run.
   */
  fingerprint: string;
};

export type PlanTagReleaseInput = {
  workspace: Workspace;
  components: readonly WorkspaceComponent[];
  requestedVersion?: string | undefined;
  choices?: VersionDecisions;
  message?: string;
};

/** Computes the release without writing anything reachable. */
export async function planTagRelease(input: PlanTagReleaseInput): Promise<TagRelease> {
  const { workspace, components } = input;
  const choices = input.choices ?? noVersionDecisions;

  const store = await openComponentHistoryStore({ workspaceRoot: workspace.rootDir });
  const decisions = new Map<string, TagDecision>();

  const recording = await prepareRecording({
    store,
    workspace,
    selected: components,
    policy: createTagPolicy(store, input.requestedVersion, decisions, choices),
    ...(input.message === undefined ? {} : { message: input.message }),
  });

  const entries: TagPlanEntry[] = [];
  for (const [position, component] of recording.components.entries()) {
    const prepared = recording.prepared[position]!;
    const decision = decisions.get(component.id)!;
    const currentVersion =
      prepared.head === undefined
        ? undefined
        : await readVersionAtSnap(store, component.id, prepared.head.hex);

    entries.push({
      componentId: component.id,
      currentVersion,
      version: decision.version,
      action: decision.action,
      createsSnap: prepared.commitId !== undefined,
      reason: await describeTagReason(store, component.id, prepared, currentVersion),
    });
  }

  return {
    store,
    workspace,
    recording,
    entries,
    fingerprint: fingerprintTagPlan(entries, recording.prepared),
  };
}

/**
 * What a plan would do, reduced to a comparable string: which components are in
 * the release, what each would receive, and whether it would be tagged.
 *
 * The prepared commit is deliberately part of it. Two plans that name the same
 * versions but were computed from different content are not the same release,
 * and the whole point of the check is to catch content that moved while the
 * user was deciding.
 */
function fingerprintTagPlan(
  entries: readonly TagPlanEntry[],
  prepared: readonly PreparedComponentSnap[]
): string {
  return entries
    .map((entry, position) =>
      [
        entry.componentId,
        entry.action,
        entry.version,
        // The content this plan measured. Two plans naming the same versions
        // over different bytes are not the same release, and content moving
        // under an open review is exactly what this guards against.
        prepared[position]?.treeId.hex ?? "",
      ].join("\u0000")
    )
    .join("\u0001");
}

/**
 * Refuses to carry out a release that is no longer the one the user approved.
 *
 * Failing is the only safe answer. A component version cannot be withdrawn, so
 * assigning one the user never saw is worse than making them look again.
 */
export function assertTagReleaseApproved(approved: string, current: TagRelease): void {
  if (approved === current.fingerprint) return;
  throw new BitLiteError(
    "the release changed while it was being reviewed, so nothing was written. " +
      "Run the command again to review the current state."
  );
}

/** Publishes a planned release. Every write in the operation happens here. */
export async function executeTagRelease(
  release: TagRelease,
  message: string | undefined
): Promise<ComponentTagResult[]> {
  const { store, workspace, recording, entries } = release;

  await publishComponentSnaps(store, recording.prepared);

  const tags: ComponentTagResult[] = [];
  for (const entry of entries) {
    if (entry.action === "skip") continue;
    tags.push(
      await tagComponent(store, {
        componentId: entry.componentId,
        version: entry.version,
        ...(message === undefined ? {} : { message }),
      })
    );
  }

  await writeRecordedVersions(workspace, recording.versionsByComponentId);
  return tags;
}

/**
 * Attributes a pending version the way `log` attributes a recorded one, by
 * comparing the tree this operation prepared against the head it would replace.
 * The prepared tree's objects already exist and are simply unreachable, so the
 * comparison reads the store rather than needing a second path for content that
 * has not been published.
 */
async function describeTagReason(
  store: ComponentHistoryStore,
  componentId: string,
  prepared: PreparedComponentSnap,
  currentVersion: string | undefined
): Promise<TagReason> {
  const headTreeId =
    prepared.head === undefined
      ? undefined
      : (await readComponentCommit(store, prepared.head)).treeId;

  const comparison = await compareComponentStates(
    store,
    componentId,
    headTreeId === undefined ? { kind: "absent" } : { kind: "recorded", treeId: headTreeId },
    { kind: "recorded", treeId: prepared.treeId }
  );

  const attribution = attributeSnapChange({
    hasParent: prepared.head !== undefined,
    fileChanges: comparison.files,
    metadata: comparison.metadata,
  });

  return {
    // Unchanged but never released still has something to release, and that is
    // a different answer from "nothing about it is new".
    neverReleased: prepared.commitId === undefined && currentVersion === undefined,
    sources: attribution.sources,
    dependencies: comparison.metadata.dependencies,
    env: comparison.metadata.env,
    otherMetadataChanged: attribution.otherMetadataChanged,
  };
}

type TagDecision = { action: "tag" | "skip"; version: string };

/**
 * Decides each component's version as the traversal reaches it, rather than up
 * front, because whether a component is skipped depends on the projection built
 * from the versions its dependencies were just given.
 *
 * A component with nothing new keeps the version it already carries. That is
 * what stops repeated `tag` runs from inflating versions: without it, every
 * repetition assigns a second version to every component, and because a
 * dependent records its dependency's version, every repetition also writes a
 * new snap for every dependent — immutable history for an operation in which
 * nothing happened. The skip propagates on its own: a skipped dependency keeps
 * its version, so its dependents see no change either.
 *
 * A per-component choice overrides that skip for the same reason an explicit
 * `--version` does: the user named this component deliberately. The choice also
 * carries the increment, which is the one part of the derivation that cannot be
 * inferred from what changed.
 */
function createTagPolicy(
  store: ComponentHistoryStore,
  requestedVersion: string | undefined,
  decisions: Map<string, TagDecision>,
  choices: VersionDecisions = noVersionDecisions
): RecordingPolicy {
  return {
    assignVersion: async (component, prepared) => {
      const choice = choices.get(component.id);
      // A version named deliberately — by --version or by a per-component
      // choice — overrides the skip.
      const named = requestedVersion !== undefined || decisionNamesVersion(choice);

      if (!named && prepared.commitId === undefined) {
        const assigned = await readVersionAtSnap(store, component.id, prepared.snapId.hex);
        // Unchanged but never released still has something to release.
        if (assigned !== undefined) {
          decisions.set(component.id, { action: "skip", version: assigned });
          return assigned;
        }
      }

      const version = assertComponentVersion(
        requestedVersion ??
          decisionExplicitVersion(choice) ??
          deriveNextComponentVersion(
            await listComponentVersions(store, component.id),
            decisionIncrement(choice)
          )
      );
      decisions.set(component.id, { action: "tag", version });
      return version;
    },
    resolveExistingVersion: async (component, head) =>
      (await readVersionAtSnap(store, component.id, head.hex)) ?? formatSnapVersion(head),
    assertSelectable: (component, head) => {
      // Tagging names a snap; it never creates a component's first one.
      if (head === undefined) {
        throw new BitLiteError(
          `component "${component.id}" has no snap to tag; run "bit-lite snap" first`
        );
      }
    },
  };
}

export function createTagReporter(
  log: (message: string) => void = console.log
): TagReporter {
  return {
    report(report) {
      if (report.cancelled === true) {
        log("release abandoned, nothing written");
        return;
      }

      const skipped = report.planned.filter((entry) => entry.action === "skip");

      if (report.planned.length === 0) {
        log("nothing to release");
        return;
      }

      if (report.dryRun) {
        for (const entry of report.planned) {
          log(
            entry.action === "skip"
              ? `unchanged ${entry.componentId} ${entry.version}`
              : `would tag ${entry.componentId} ${entry.version}` +
                  `${entry.createsSnap ? " (creates a snap)" : ""}`
          );
        }
        const count = report.planned.length - skipped.length;
        log(
          `${countOf(count, "component")} would be tagged, ` +
            `${skipped.length} unchanged (dry run, nothing written)`
        );
        return;
      }

      for (const entry of skipped) {
        log(`unchanged ${entry.componentId} ${entry.version}`);
      }
      for (const tag of report.tags) {
        const label = tag.status === "created" ? "tagged" : "already tagged";
        log(`${label} ${tag.componentId} ${tag.version} ${abbreviateComponentVersion(tag.snapId)}`);
      }
      log(`${countOf(report.tags.length, "component")} tagged, ${skipped.length} unchanged`);
    },
  };
}

/** Structured output carries complete version identifiers, never abbreviated. */
export function createTagJsonReporter(
  log: (message: string) => void = console.log
): TagReporter {
  return {
    report(report) {
      log(
        JSON.stringify(
          {
            storePath: report.storePath,
            dryRun: report.dryRun,
            components: report.planned.map((entry) => ({
              ...entry,
              ...(report.tags.find((tag) => tag.componentId === entry.componentId) ?? {}),
            })),
          },
          null,
          2
        )
      );
    },
  };
}

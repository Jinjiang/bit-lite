import { readWorkspace, selectWorkspaceComponents } from "bit-lite-context";
import type { CliOptionValue, ParsedCliArgs, WorkspaceComponent } from "bit-lite-context";
import {
  abbreviateComponentVersion,
  assertComponentVersion,
  deriveNextComponentVersion,
  formatSnapVersion,
  listComponentVersions,
  openComponentHistoryStore,
  publishComponentSnaps,
  readVersionAtSnap,
  tagComponent,
  type ComponentHistoryStore,
  type ComponentTagResult,
} from "bit-lite-history";
import { BitLiteError } from "../utils/errors.js";
import { readFlagOption, readTextOption } from "../utils/command-options.js";
import {
  prepareRecording,
  writeRecordedVersions,
  type RecordingPolicy,
} from "../utils/component-recording.js";

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

/** What a component would receive, known before anything is written. */
export type TagPlanEntry = {
  componentId: string;
  version: string;
  /** `skip` when nothing about the component is new; it keeps the version shown. */
  action: "tag" | "skip";
  /** Whether tagging must create a snap because the projection changed content. */
  createsSnap: boolean;
};

export type TagReport = {
  storePath: string;
  /** When true nothing was published: the report describes what would happen. */
  dryRun: boolean;
  /** Always populated; on a dry run it is the only account of the operation. */
  planned: readonly TagPlanEntry[];
  /** Empty on a dry run, because no tag was created. */
  tags: readonly ComponentTagResult[];
};

export type RunTagCommandOptions = {
  reporter?: TagReporter;
};

export async function runTagCommand(
  parsed: ParsedCliArgs,
  options: RunTagCommandOptions = {}
): Promise<TagReport> {
  const dryRun = readFlagOption(parsed.args.options["dry-run"], "--dry-run");
  const asJson = readFlagOption(parsed.args.options.json, "--json");
  // Validated before the store is opened, so a bad version fails immediately.
  const requested = readVersionOption(parsed.args.options.version);
  const requestedVersion = requested === undefined ? undefined : assertComponentVersion(requested);
  const message = readTextOption(parsed.args.options.message, "--message");
  const reporter = options.reporter ?? (asJson ? createTagJsonReporter() : createTagReporter());

  const workspace = await readWorkspace(parsed.workspaceRoot);
  const components = selectWorkspaceComponents(workspace, parsed.componentFilters);
  if (components.length === 0) {
    throw new BitLiteError("no registered components to tag");
  }
  if (requestedVersion !== undefined && components.length !== 1) {
    const ids = components.map((component) => component.id).join(", ");
    throw new BitLiteError(
      `--version applies to exactly one component, but the selection matched ${components.length}: ${ids}. ` +
        "Narrow the selection with --filter, or omit --version to derive a version for each component."
    );
  }

  const store = await openComponentHistoryStore({ workspaceRoot: workspace.rootDir });
  const decisions = new Map<string, TagDecision>();

  const recording = await prepareRecording({
    store,
    workspace,
    selected: components,
    policy: createTagPolicy(store, requestedVersion, decisions),
    ...(message === undefined ? {} : { message }),
  });
  const planned = recording.components.map((component, position) => ({
    componentId: component.id,
    version: decisions.get(component.id)!.version,
    action: decisions.get(component.id)!.action,
    createsSnap: recording.prepared[position]?.commitId !== undefined,
  }));

  const tags: ComponentTagResult[] = [];
  if (!dryRun) {
    await publishComponentSnaps(store, recording.prepared);
    for (const entry of planned) {
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
  }

  const report: TagReport = { storePath: store.gitDir, dryRun, planned, tags };
  reporter.report(report);
  return report;
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
 */
function createTagPolicy(
  store: ComponentHistoryStore,
  requestedVersion: string | undefined,
  decisions: Map<string, TagDecision>
): RecordingPolicy {
  return {
    assignVersion: async (component, prepared) => {
      // An explicit version was named deliberately, so it overrides the skip.
      if (requestedVersion === undefined && prepared.commitId === undefined) {
        const assigned = await readVersionAtSnap(store, component.id, prepared.snapId.hex);
        // Unchanged but never released still has something to release.
        if (assigned !== undefined) {
          decisions.set(component.id, { action: "skip", version: assigned });
          return assigned;
        }
      }

      const version = assertComponentVersion(
        requestedVersion ??
          deriveNextComponentVersion(await listComponentVersions(store, component.id))
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

function readVersionOption(value: CliOptionValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    throw new BitLiteError("--version accepts exactly one value");
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new BitLiteError("--version requires a version");
  }
  return value;
}

export function createTagReporter(
  log: (message: string) => void = console.log
): TagReporter {
  return {
    report(report) {
      const skipped = report.planned.filter((entry) => entry.action === "skip");

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
          `${count} component${count === 1 ? "" : "s"} would be tagged, ` +
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
      log(
        `${report.tags.length} component${report.tags.length === 1 ? "" : "s"} tagged, ` +
          `${skipped.length} unchanged`
      );
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

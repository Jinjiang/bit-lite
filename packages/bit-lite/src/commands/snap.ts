import { readWorkspace, selectWorkspaceComponents } from "bit-lite-context";
import type { ParsedCliArgs } from "bit-lite-context";
import {
  abbreviateComponentVersion,
  describeComponentSnaps,
  openComponentHistoryStore,
  publishComponentSnaps,
  type ComponentSnapResult,
} from "bit-lite-history";
import { BitLiteError } from "../utils/errors.js";
import { readFlagOption, readTextOption } from "../utils/command-options.js";
import { prepareRecording, writeRecordedVersions } from "../utils/component-recording.js";

/**
 * What: records the selected components in the durable component history store.
 *
 * Why: snap reads the workspace through `readWorkspace` rather than the fuller
 * env-resolving path, because what it records is derived from declared
 * workspace state alone. That keeps the command independent of installed
 * packages, linking, and compilation, and it means no other command has to
 * touch the history store.
 *
 * Components are prepared in dependency order so every workspace dependency
 * and env already carries a version by the time the component naming it is
 * recorded. Refs move in one transaction afterwards, and version anchors are
 * written only once that succeeded.
 */

export type SnapReporter = {
  report: (report: SnapReport) => void;
};

export type SnapReport = {
  storePath: string;
  /** When true nothing was published: the report describes what would happen. */
  dryRun: boolean;
  components: readonly ComponentSnapResult[];
  changed: readonly ComponentSnapResult[];
  unchanged: readonly ComponentSnapResult[];
  /** Version each recorded component now carries, keyed by component id. */
  versionsByComponentId: ReadonlyMap<string, string>;
};

export type RunSnapCommandOptions = {
  reporter?: SnapReporter;
};

export async function runSnapCommand(
  parsed: ParsedCliArgs,
  options: RunSnapCommandOptions = {}
): Promise<SnapReport> {
  const dryRun = readFlagOption(parsed.args.options["dry-run"], "--dry-run");
  const asJson = readFlagOption(parsed.args.options.json, "--json");
  const message = readTextOption(parsed.args.options.message, "--message");
  const reporter =
    options.reporter ?? (asJson ? createSnapJsonReporter() : createSnapReporter());

  const workspace = await readWorkspace(parsed.workspaceRoot);
  // With no filters this selects every registered component; with filters it
  // raises the workspace's own "did not match any components" error.
  const components = selectWorkspaceComponents(workspace, parsed.componentFilters);
  if (components.length === 0) {
    throw new BitLiteError("no registered components to snap");
  }

  const store = await openComponentHistoryStore({ workspaceRoot: workspace.rootDir });
  const recording = await prepareRecording({
    store,
    workspace,
    selected: components,
    ...(message === undefined ? {} : { message }),
  });

  // A dry run stops between the two phases. Objects prepared for it are
  // unreachable and left to Git, exactly as they are after a failed operation.
  const result = dryRun
    ? describeComponentSnaps(recording.prepared)
    : await publishComponentSnaps(store, recording.prepared);
  if (!dryRun) {
    await writeRecordedVersions(workspace, recording.versionsByComponentId);
  }

  const report: SnapReport = {
    storePath: store.gitDir,
    dryRun,
    components: result.components,
    changed: result.changed,
    unchanged: result.unchanged,
    versionsByComponentId: recording.versionsByComponentId,
  };
  reporter.report(report);
  return report;
}

export function createSnapReporter(
  log: (message: string) => void = console.log
): SnapReporter {
  return {
    report(report) {
      for (const component of report.components) {
        const label =
          component.status === "created"
            ? report.dryRun
              ? "would snap"
              : "snapped"
            : "unchanged";
        const version = report.versionsByComponentId.get(component.componentId);
        // Versions are abbreviated for reading only; files always carry the
        // complete object ID.
        log(
          `${label} ${component.componentId} ` +
            `${version === undefined ? component.snapId : abbreviateComponentVersion(version)}`
        );
      }
      const changedCount = report.changed.length;
      const unchangedCount = report.unchanged.length;
      log(
        `${changedCount} component${changedCount === 1 ? "" : "s"} ` +
          `${report.dryRun ? "would be snapped" : "snapped"}, ${unchangedCount} unchanged` +
          `${report.dryRun ? " (dry run, nothing written)" : ""}`
      );
    },
  };
}

/** Structured output carries complete version identifiers, never abbreviated. */
export function createSnapJsonReporter(
  log: (message: string) => void = console.log
): SnapReporter {
  return {
    report(report) {
      log(
        JSON.stringify(
          {
            storePath: report.storePath,
            dryRun: report.dryRun,
            components: report.components.map((component) => ({
              ...component,
              version: report.versionsByComponentId.get(component.componentId) ?? null,
            })),
          },
          null,
          2
        )
      );
    },
  };
}

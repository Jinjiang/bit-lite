import { readWorkspace, selectWorkspaceComponents } from "bit-lite-context";
import type { ParsedCliArgs, WorkspaceComponent } from "bit-lite-context";
import {
  openComponentHistoryStore,
  snapComponents,
  type ComponentSnapResult,
  type SnapRequest,
} from "bit-lite-history";
import { BitLiteError } from "../utils/errors.js";

/**
 * What: records the selected components in the durable component history store.
 *
 * Why: snap reads the workspace through `readWorkspace` rather than the fuller
 * env-resolving path, because a v1 snap captures component files only. That
 * keeps the command independent of env packages, linking, and compilation, and
 * it means no other command has to touch the history store.
 */

export type SnapReporter = {
  report: (report: SnapReport) => void;
};

export type SnapReport = {
  storePath: string;
  components: readonly ComponentSnapResult[];
  changed: readonly ComponentSnapResult[];
  unchanged: readonly ComponentSnapResult[];
};

export type RunSnapCommandOptions = {
  reporter?: SnapReporter;
};

export async function runSnapCommand(
  parsed: ParsedCliArgs,
  options: RunSnapCommandOptions = {}
): Promise<SnapReport> {
  const reporter = options.reporter ?? createSnapReporter();

  const workspace = await readWorkspace(parsed.workspaceRoot);
  // With no filters this selects every registered component; with filters it
  // raises the workspace's own "did not match any components" error.
  const components = selectWorkspaceComponents(workspace, parsed.componentFilters);
  if (components.length === 0) {
    throw new BitLiteError("no registered components to snap");
  }

  const store = await openComponentHistoryStore({ workspaceRoot: workspace.rootDir });
  const result = await snapComponents(store, components.map(toSnapRequest));

  const report: SnapReport = {
    storePath: store.gitDir,
    components: result.components,
    changed: result.changed,
    unchanged: result.unchanged,
  };
  reporter.report(report);
  return report;
}

function toSnapRequest(component: WorkspaceComponent): SnapRequest {
  return { componentId: component.id, rootDir: component.rootDir };
}

export function createSnapReporter(
  log: (message: string) => void = console.log
): SnapReporter {
  return {
    report(report) {
      for (const component of report.components) {
        const label = component.status === "created" ? "snapped" : "unchanged";
        log(`${label} ${component.componentId} ${component.snapId}`);
      }
      const changedCount = report.changed.length;
      const unchangedCount = report.unchanged.length;
      log(
        `${changedCount} component${changedCount === 1 ? "" : "s"} snapped, ` +
          `${unchangedCount} unchanged`
      );
    },
  };
}

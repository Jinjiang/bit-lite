import { readWorkspace, selectWorkspaceComponents } from "bit-lite-context";
import type { CliOptionValue, ParsedCliArgs } from "bit-lite-context";
import {
  openComponentHistoryStore,
  tagComponent,
  type ComponentTagResult,
} from "bit-lite-history";
import { BitLiteError } from "../utils/errors.js";

/**
 * What: assigns an immutable semantic version to a component's current snap.
 *
 * Why: a version names one specific component snap, so the command requires a
 * selection that resolves to exactly one component and never creates a snap of
 * its own. Ambiguity is an error rather than a guess.
 */

export type TagReporter = {
  report: (report: TagReport) => void;
};

export type TagReport = {
  storePath: string;
  tag: ComponentTagResult;
};

export type RunTagCommandOptions = {
  reporter?: TagReporter;
};

export async function runTagCommand(
  parsed: ParsedCliArgs,
  options: RunTagCommandOptions = {}
): Promise<TagReport> {
  const reporter = options.reporter ?? createTagReporter();
  const version = readVersionOption(parsed.args.options.version);

  if (parsed.componentFilters.length === 0) {
    throw new BitLiteError("bit-lite tag requires --filter <component-pattern>");
  }

  const workspace = await readWorkspace(parsed.workspaceRoot);
  const components = selectWorkspaceComponents(workspace, parsed.componentFilters);
  if (components.length !== 1) {
    const ids = components.map((component) => component.id).join(", ");
    throw new BitLiteError(
      `bit-lite tag requires exactly one component, but --filter matched ${components.length}: ${ids}`
    );
  }

  const component = components[0]!;
  const store = await openComponentHistoryStore({ workspaceRoot: workspace.rootDir });
  const tag = await tagComponent(store, { componentId: component.id, version });

  const report: TagReport = { storePath: store.gitDir, tag };
  reporter.report(report);
  return report;
}

function readVersionOption(value: CliOptionValue | undefined): string {
  if (Array.isArray(value)) {
    throw new BitLiteError("--version accepts exactly one value");
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new BitLiteError("bit-lite tag requires --version <semver>");
  }
  return value;
}

export function createTagReporter(
  log: (message: string) => void = console.log
): TagReporter {
  return {
    report({ tag }) {
      const label = tag.status === "created" ? "tagged" : "already tagged";
      log(`${label} ${tag.componentId} ${tag.version} ${tag.snapId}`);
    },
  };
}

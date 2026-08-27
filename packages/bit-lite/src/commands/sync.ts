import { readWorkspace } from "bit-lite-context";
import type { CliOptionValue, ParsedCliArgs } from "bit-lite-context";
import {
  openComponentHistoryStore,
  syncComponentHistory,
  type SyncResult,
} from "bit-lite-history";
import { BitLiteError } from "../utils/errors.js";

/**
 * What: synchronizes component histories and tags with the store's remote.
 *
 * Why: sync operates on the whole store rather than a component selection,
 * because a component present only on one side has to be discovered rather than
 * named. Conflicts are reported in full and then fail the command, so a user
 * sees every problem at once instead of one per rerun.
 */

export type SyncReporter = {
  report: (result: SyncResult) => void;
};

export type RunSyncCommandOptions = {
  reporter?: SyncReporter;
};

export async function runSyncCommand(
  parsed: ParsedCliArgs,
  options: RunSyncCommandOptions = {}
): Promise<SyncResult> {
  const reporter = options.reporter ?? createSyncReporter();
  const requestedUrl = readRemoteOption(parsed.args.options.remote);

  const workspace = await readWorkspace(parsed.workspaceRoot);
  const store = await openComponentHistoryStore({ workspaceRoot: workspace.rootDir });
  const result = await syncComponentHistory(
    store,
    requestedUrl === undefined ? {} : { requestedUrl }
  );

  reporter.report(result);

  if (result.conflicts.length > 0) {
    throw new BitLiteError(
      `synchronization stopped with ${result.conflicts.length} conflict${result.conflicts.length === 1 ? "" : "s"}; no refs were changed`
    );
  }

  return result;
}

function readRemoteOption(value: CliOptionValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    throw new BitLiteError("--remote accepts exactly one value");
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new BitLiteError("--remote requires a URL");
  }
  return value;
}

export function createSyncReporter(
  log: (message: string) => void = console.log,
  logError: (message: string) => void = console.error
): SyncReporter {
  return {
    report(result) {
      for (const head of result.heads) {
        log(`${head.outcome} ${head.componentId}`);
      }
      for (const tag of result.tags) {
        log(`${tag.outcome} ${tag.componentId} ${tag.version}`);
      }
      for (const conflict of result.conflicts) {
        logError(conflict);
      }
      if (result.upToDate) {
        log(`already up to date with ${result.remoteUrl}`);
      }
    },
  };
}

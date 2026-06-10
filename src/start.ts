import { runService } from "./runtime.js";
import { startTestWatchersForWorkspace } from "./preview.js";
import type { ServiceRunResult } from "./runtime.js";
import type { WorkspaceRuntime } from "./types.js";

export async function runStart(workspace: WorkspaceRuntime): Promise<ServiceRunResult[]> {
  const results = await runService(workspace, "preview");
  await startTestWatchersForWorkspace(workspace);
  return results;
}

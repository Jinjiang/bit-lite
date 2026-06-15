import {
  createDashboardOutputReporter,
  createPrefixedOutputReporter,
  getServiceVendorLabels,
  type ServiceRunReporter,
} from "./output-reporter.js";
import type { WorkspaceRuntime } from "./types.js";

export type TestRunReporter = ServiceRunReporter;

export function createTestRunReporter(workspace: WorkspaceRuntime, watch: boolean): TestRunReporter {
  const labels = getServiceVendorLabels(workspace, "test");
  return watch
    ? createDashboardOutputReporter({
        title: "bit-lite test watch",
        labels,
        formatStatus: formatTestWatchStatus,
      })
    : createPrefixedOutputReporter(labels);
}

function formatTestWatchStatus(status: string) {
  if (status === "passed") return "ended";
  return status;
}

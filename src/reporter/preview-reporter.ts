import {
  createDashboardOutputReporter,
  getServiceVendorLabels,
  type ServiceRunReporter,
} from "./output-reporter.js";
import type { WorkspaceRuntime } from "../types/index.js";

export type PreviewRunReporter = ServiceRunReporter;

export function createPreviewRunReporter(workspace: WorkspaceRuntime): PreviewRunReporter {
  return createDashboardOutputReporter({
    title: "bit-lite preview",
    labels: getServiceVendorLabels(workspace, "preview"),
    formatStatus: formatPreviewStatus,
  });
}

function formatPreviewStatus(status: string) {
  if (status === "passed") return "ended";
  return status;
}

import {
  createDashboardOutputReporter,
  getServiceVendorLabels,
  type ServiceRunReporter,
} from "./output-reporter.js";
import type { ServiceRunEventContext } from "../runtime.js";
import type { WorkspaceRuntime } from "../types/index.js";

export type StartRunReporter = ServiceRunReporter;

export function createStartRunReporter(workspace: WorkspaceRuntime): StartRunReporter {
  return createDashboardOutputReporter({
    title: "bit-lite start",
    labels: getStartLabels(workspace),
    formatLabel,
    formatStatus,
  });
}

function getStartLabels(workspace: WorkspaceRuntime) {
  const labels = new Map<string, string | undefined>();
  for (const serviceName of ["preview", "test"]) {
    for (const [envName, vendor] of getServiceVendorLabels(workspace, serviceName)) {
      labels.set(`${envName}\0${serviceName}`, vendor);
    }
  }
  return labels;
}

function formatLabel(context: ServiceRunEventContext, vendor: string | undefined) {
  return `${context.serviceRef} ${context.envName}/${vendor ?? context.serviceName}`;
}

function formatStatus(status: string) {
  if (status === "passed") return "ended";
  return status;
}

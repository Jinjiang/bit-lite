import { createCommandHost, type CommandHost } from "../host/server.js";
import {
  createDashboardOutputReporter,
  getServiceVendorLabels,
  type DashboardOutputReporter,
  type DashboardReporterItem,
  type ServiceRunReporter,
} from "../reporter/output-reporter.js";
import type { ServiceRunEventContext } from "../runtime.js";
import type { ServiceRunResult, WorkspaceRuntime } from "../types/index.js";
import type { PreviewEntry } from "../types/services/preview.js";
import { closePreviewVendorServers } from "../services/preview/runtime.js";
import {
  createPreviewReadyItems,
  createPreviewStartupItems,
  createPreviewViews,
  runPreviewServices,
  type PreviewViewContext,
} from "./preview.js";
import { createTestResultStore, runTestServices } from "./test.js";
import { installRunControls, waitForAbort } from "./helpers.js";
import type { BitLiteCommand } from "./types.js";

export const startCommand: BitLiteCommand = {
  name: "start",
  async run({ workspace, args }) {
    if (args.length > 0) {
      throw new Error(`start does not accept arguments: ${args.join(" ")}`);
    }

    const host = await createCommandHost({ title: "bit-lite start" });
    const controller = new AbortController();
    const reporter = createStartRunReporter(workspace, host.url);
    reporter.render();
    const cleanupControls = installRunControls(controller, (chunk) => reporter.onInput?.(chunk));
    const tests = createTestResultStore();
    registerTestRoutes(host, tests);

    try {
      const testResultsPromise = runTestServices(workspace, {
        args: { watch: true },
        signal: controller.signal,
        reporter,
        optional: true,
        onStart: (envName) => tests.start(envName),
        onEvent: (type, payload, context) => tests.event(type, payload, context),
        onResult: (result) => tests.exit(result),
        onError: (envName, error) => tests.error(envName, error),
      }).catch(() => []);
      const previewResults = await runPreviewServices(workspace, {
        signal: controller.signal,
        reporter,
        host,
        createViews: createStartPreviewViews,
      });

      const ok = previewResults.every(({ result }) => result.ok);
      showStartReadyReporter(reporter, workspace, previewResults, host.url, ok);
      if (ok) {
        await waitForAbort(controller.signal);
      }
      controller.abort();
      await testResultsPromise;
      return ok ? 0 : 1;
    } finally {
      controller.abort();
      cleanupControls();
      reporter.close?.();
      await host.stop();
      await closePreviewVendorServers();
    }
  },
};

function registerTestRoutes(host: CommandHost, tests: ReturnType<typeof createTestResultStore>) {
  host.registerRoute({
    path: "/api/tests",
    handler({ url, sendJson }) {
      sendJson(tests.get(url.searchParams.get("env") ?? undefined));
    },
  });
  host.registerRoute({
    path: "/tests",
    handler({ sendAsset }) {
      return sendAsset("tests.html");
    },
  });
}

function createStartPreviewViews(entry: PreviewEntry, context: PreviewViewContext) {
  const component = encodeURIComponent(entry.id);
  const views = createPreviewViews(entry, context);
  if (entry.docsFile) {
    views.push({
      type: "docs",
      label: "Docs",
      url: `${context.base}?component=${component}&view=docs`,
    });
  }
  if (entry.sourceFile) {
    views.push({
      type: "source",
      label: "Source",
      url: `${context.base}?component=${component}&view=source`,
    });
  }
  views.push({
    type: "tests",
    label: "Tests",
    url: `/tests?env=${encodeURIComponent(context.envName)}&component=${component}`,
  });
  return views;
}

function createStartRunReporter(workspace: WorkspaceRuntime, hostUrl: string): DashboardOutputReporter {
  return createDashboardOutputReporter({
    title: "bit-lite start starting",
    labels: getStartLabels(workspace),
    items: createStartStartupItems(workspace),
    summary: [`start UI: ${hostUrl}`, "starting dev servers and test watchers..."],
    formatLabel,
    formatStatus,
  });
}

function showStartReadyReporter(
  reporter: DashboardOutputReporter,
  workspace: WorkspaceRuntime,
  previewResults: ServiceRunResult[],
  hostUrl: string,
  ok: boolean
) {
  reporter.setTitle("bit-lite start");
  reporter.setSummary([`start UI: ${hostUrl}`, ok ? "dev servers ready; tests watching" : "dev server startup failed"]);
  reporter.setItems([...createPreviewReadyItems(previewResults), ...createTestReadyItems(workspace)]);
  reporter.render();
}

function createStartStartupItems(workspace: WorkspaceRuntime): DashboardReporterItem[] {
  return [...createPreviewStartupItems(workspace), ...createTestStartupItems(workspace)];
}

function createTestStartupItems(workspace: WorkspaceRuntime): DashboardReporterItem[] {
  const items: DashboardReporterItem[] = [];
  for (const group of workspace.groups) {
    const vendor = readServiceVendor(group.env.services.test);
    if (!vendor) continue;
    items.push({
      envName: group.envName,
      serviceRef: "test",
      serviceName: "test",
      vendor,
      status: "pending",
      detail: `${formatComponentCount(group.components.length)}`,
    });
  }
  return items;
}

function createTestReadyItems(workspace: WorkspaceRuntime): DashboardReporterItem[] {
  return createTestStartupItems(workspace).map(({ status: _status, ...item }) => item);
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

function readServiceVendor(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const vendor = (value as { vendor?: unknown }).vendor;
  return typeof vendor === "string" ? vendor : undefined;
}

function formatComponentCount(count: number) {
  return `${count} ${count === 1 ? "component" : "components"}`;
}

import { createCommandHost, type CommandHost } from "../host/server.js";
import {
  createDashboardOutputReporter,
  getServiceVendorLabels,
  type ServiceRunReporter,
} from "../reporter/output-reporter.js";
import type { ServiceRunEventContext } from "../runtime.js";
import type { WorkspaceRuntime } from "../types/index.js";
import type { PreviewEntry } from "../types/services/preview.js";
import { closePreviewVendorServers } from "../services/preview/runtime.js";
import { createPreviewViews, runPreviewServices, type PreviewViewContext } from "./preview.js";
import { createTestResultStore, runTestServices } from "./test.js";
import { installRunControls, printServiceResults, waitForAbort } from "./helpers.js";
import type { BitLiteCommand } from "./types.js";

export const startCommand: BitLiteCommand = {
  name: "start",
  async run({ workspace, args }) {
    if (args.length > 0) {
      throw new Error(`start does not accept arguments: ${args.join(" ")}`);
    }

    const controller = new AbortController();
    const reporter = createStartRunReporter(workspace);
    const cleanupControls = installRunControls(controller, (chunk) => reporter.onInput?.(chunk));
    const host = await createCommandHost({ title: "bit-lite start" });
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

      reporter.flush();
      printServiceResults("start", previewResults);
      if (previewResults.every(({ result }) => result.ok)) {
        console.log(`start UI running at ${host.url}`);
        await waitForAbort(controller.signal);
      }
      controller.abort();
      await testResultsPromise;
      return previewResults.every(({ result }) => result.ok) ? 0 : 1;
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

function createStartRunReporter(workspace: WorkspaceRuntime): ServiceRunReporter {
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

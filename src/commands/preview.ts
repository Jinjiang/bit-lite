import { createCommandHost, type CommandHost, type HostView } from "../host/server.js";
import {
  createDashboardOutputReporter,
  getServiceVendorLabels,
  type ServiceRunReporter,
} from "../reporter/output-reporter.js";
import { resolveRunnableGroups, runRunnableGroup } from "../runtime.js";
import { closePreviewVendorServers } from "../services/preview/runtime.js";
import type { WorkspaceRuntime } from "../types/index.js";
import type { PreviewEntry, PreviewResult } from "../types/services/preview.js";
import { installRunControls, printServiceResults, waitForAbort } from "./helpers.js";
import type { BitLiteCommand } from "./types.js";

const FIRST_ENV_PORT = 3301;

export type PreviewViewContext = {
  envName: string;
  base: string;
  result: PreviewResult;
};

export type PreviewViewFactory = (entry: PreviewEntry, context: PreviewViewContext) => HostView[];

export type RunPreviewServicesOptions = {
  signal?: AbortSignal;
  reporter?: ServiceRunReporter;
  host?: CommandHost;
  firstPort?: number;
  createViews?: PreviewViewFactory;
};

export const previewCommand: BitLiteCommand = {
  name: "preview",
  async run({ workspace, args }) {
    if (args.length > 0) {
      throw new Error(`preview does not accept arguments: ${args.join(" ")}`);
    }

    const controller = new AbortController();
    const reporter = createPreviewRunReporter(workspace);
    const cleanupControls = installRunControls(controller, (chunk) => reporter.onInput?.(chunk));
    const host = await createCommandHost({ title: "bit-lite preview" });
    try {
      const results = await runPreviewServices(workspace, {
        signal: controller.signal,
        reporter,
        host,
      });

      reporter.flush();
      printServiceResults("preview", results);
      if (results.every(({ result }) => result.ok)) {
        console.log(`preview UI running at ${host.url}`);
        await waitForAbort(controller.signal);
      }
      return results.every(({ result }) => result.ok) ? 0 : 1;
    } finally {
      cleanupControls();
      reporter.close?.();
      await host.stop();
      await closePreviewVendorServers();
    }
  },
};

export async function runPreviewServices(workspace: WorkspaceRuntime, options: RunPreviewServicesOptions = {}) {
  const runnableGroups = await resolveRunnableGroups(workspace, "preview");
  const firstPort = options.firstPort ?? FIRST_ENV_PORT;
  return Promise.all(
    runnableGroups.map(async (runnableGroup, index) => {
      const envName = runnableGroup.group.envName;
      const result = await runRunnableGroup(runnableGroup, {
        workspaceRoot: workspace.workspaceRoot,
        args: {
          port: firstPort + index,
          base: `/env/${encodeURIComponent(envName)}/`,
        },
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.reporter?.onEvent ? { onEvent: options.reporter.onEvent } : {}),
        ...(options.reporter?.onTask ? { onTask: options.reporter.onTask } : {}),
      });
      if (options.host) {
        registerPreviewResult(
          options.host,
          result.envName,
          result.result as PreviewResult,
          options.createViews ?? createPreviewViews
        );
      }
      return result;
    })
  );
}

export function createPreviewViews(entry: PreviewEntry, context: PreviewViewContext): HostView[] {
  const component = encodeURIComponent(entry.id);
  return [
    {
      type: "preview",
      label: "Demo",
      url: `${context.base}?component=${component}&view=preview`,
    },
  ];
}

function registerPreviewResult(
  host: CommandHost,
  envName: string,
  result: PreviewResult,
  createViews: PreviewViewFactory
) {
  if (!result.host || !result.port || !result.base || !result.url || !result.entries || !result.vendor) return;
  host.registerProxy({
    pathPrefix: result.base,
    host: result.host,
    port: result.port,
  });
  host.registerRegistrySection({
    key: envName,
    title: envName,
    subtitle: result.vendor,
    envName,
    vendor: result.vendor,
    url: result.url,
    proxyBase: result.base,
    components: result.entries.map((entry) => ({
      id: entry.id,
      rootDir: entry.rootDir,
      views: createViews(entry, {
        envName,
        base: result.base ?? "",
        result,
      }),
    })),
  });
}

function createPreviewRunReporter(workspace: WorkspaceRuntime): ServiceRunReporter {
  return createDashboardOutputReporter({
    title: "bit-lite preview",
    labels: getServiceVendorLabels(workspace, "preview"),
    formatStatus,
  });
}

function formatStatus(status: string) {
  if (status === "passed") return "ended";
  return status;
}

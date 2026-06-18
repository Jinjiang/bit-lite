import { createCommandHost, type CommandHost, type HostView } from "../host/server.js";
import {
  createDashboardOutputReporter,
  getServiceVendorLabels,
  type DashboardOutputReporter,
  type DashboardReporterItem,
  type ServiceRunReporter,
} from "../reporter/output-reporter.js";
import { resolveRunnableGroups, runRunnableGroup } from "../runtime.js";
import { closePreviewVendorServers } from "../services/preview/runtime.js";
import type { ServiceRunResult, WorkspaceRuntime } from "../types/index.js";
import type { PreviewEntry, PreviewResult } from "../types/services/preview.js";
import { installRunControls, waitForAbort } from "./helpers.js";
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

    const host = await createCommandHost({ title: "bit-lite preview" });
    const controller = new AbortController();
    const reporter = createPreviewRunReporter(workspace, host.url);
    reporter.render();
    const cleanupControls = installRunControls(controller, (chunk) => reporter.onInput?.(chunk));
    try {
      const results = await runPreviewServices(workspace, {
        signal: controller.signal,
        reporter,
        host,
      });

      const ok = results.every(({ result }) => result.ok);
      showPreviewReadyReporter(reporter, results, host.url, ok);
      if (ok) {
        await waitForAbort(controller.signal);
      }
      return ok ? 0 : 1;
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

function createPreviewRunReporter(workspace: WorkspaceRuntime, hostUrl: string): DashboardOutputReporter {
  return createDashboardOutputReporter({
    title: "bit-lite preview starting",
    labels: getServiceVendorLabels(workspace, "preview"),
    items: createPreviewStartupItems(workspace),
    summary: [`preview UI: ${hostUrl}`, "starting dev servers..."],
    formatStatus,
  });
}

function showPreviewReadyReporter(
  reporter: DashboardOutputReporter,
  results: ServiceRunResult[],
  hostUrl: string,
  ok: boolean
) {
  reporter.setTitle("bit-lite preview");
  reporter.setSummary([`preview UI: ${hostUrl}`, ok ? "dev servers ready" : "dev server startup failed"]);
  reporter.setItems(createPreviewReadyItems(results));
  reporter.render();
}

export function createPreviewStartupItems(workspace: WorkspaceRuntime, firstPort = FIRST_ENV_PORT): DashboardReporterItem[] {
  const items: DashboardReporterItem[] = [];
  let index = 0;
  for (const group of workspace.groups) {
    const vendor = readServiceVendor(group.env.services.preview);
    if (!vendor) continue;
    const port = firstPort + index;
    index += 1;
    items.push({
      envName: group.envName,
      serviceRef: "preview",
      serviceName: "preview",
      vendor,
      status: "pending",
      detail: `:${port}  ${formatComponentCount(group.components.length)}`,
    });
  }
  return items;
}

export function createPreviewReadyItems(results: ServiceRunResult[]): DashboardReporterItem[] {
  return results.map(({ envName, result }) => {
    const previewResult = result as PreviewResult;
    const vendor = previewResult.vendor;
    return {
      envName,
      serviceRef: "preview",
      serviceName: "preview",
      ...(vendor ? { vendor } : {}),
      status: result.ok ? "ready" : "failed",
      detail: result.ok
        ? `${previewResult.url ?? ""}  ${formatComponentCount(previewResult.entries?.length ?? 0)}`
        : result.toString(),
    };
  });
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

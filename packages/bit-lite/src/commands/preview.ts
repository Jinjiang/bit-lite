import { groupSelectedComponentsByEnv, loadWorkspace, selectComponentRefs } from "bit-lite-context";
import { watchVendorTasks } from "bit-lite-vendors";
import { BitLiteError } from "../utils/errors.js";
import {
  PreviewProxyServer,
  encodeRouteSegment,
  findAvailablePort,
  type PreviewServerInfo,
  type PreviewSkippedEnv,
} from "./preview-proxy.js";
import type { CliOptionValue, ParsedCliArgs, SelectedEnvGroup, WorkspaceRuntime } from "bit-lite-context";
import type { JsonObject, VendorMessage, VendorTask, VendorTaskStartOptions } from "bit-lite-vendors";

export type PreviewVendorRuntime = JsonObject & {
  host: string;
  port: number;
  basePath: string;
  proxyOrigin: string;
};

export type PreviewServiceResult = JsonObject & {
  service: "preview";
  vendor: string;
  envName: string;
  mode: "serve";
  server: PreviewServerInfo;
};

type PreviewTaskSpec = {
  envName: string;
  components: SelectedEnvGroup["components"];
  serviceConfig: unknown;
  taskOptions: VendorTaskStartOptions;
};

const serviceId = "preview";
const label = "Preview";
const defaultHost = "127.0.0.1";
const defaultProxyPort = 4000;
const defaultVendorPort = 6000;

export async function runPreviewCommand(parsed: ParsedCliArgs) {
  const workspace = await loadWorkspace(parsed.workspaceRoot);
  const components = selectComponentRefs(workspace.components, parsed.componentFilters);
  const groups = groupSelectedComponentsByEnv(workspace, components);
  const { tasks, skipped } = createPreviewTaskSpecs(workspace, groups, parsed);

  if (tasks.length === 0) {
    printNoPreviewTasks(groups);
    return;
  }

  const host = readHost(parsed.args.options.host);
  const proxyPort = readPort(parsed.args.options.port, "--port", defaultProxyPort);
  const proxyServer = new PreviewProxyServer({
    envs: tasks.map((task) => ({
      envName: task.envName,
      taskId: task.envName,
      vendor: readVendorLabel(task.serviceConfig),
      status: "starting",
      components: task.components,
    })),
    skipped,
  });
  const proxy = await proxyServer.start(host, proxyPort);
  const taskOptions = await addPreviewRuntime(tasks, proxy.origin, host);
  const componentCounts = new Map(tasks.map((task) => [task.envName, task.components.length]));
  let proxyCleanupRegistered = false;

  try {
    console.log(`Preview: ${proxyServer.origin}`);
    await watchVendorTasks<PreviewServiceResult>(taskOptions, {
      serviceId,
      label,
      title: () => `Preview: ${proxyServer.origin}`,
      formatResult(result) {
        return formatPreviewResult(result, componentCounts);
      },
      onResult(result, task) {
        proxyServer.updateServer(task.envName, result.server, result.vendor);
      },
      onTasksStarted(tasks) {
        proxyCleanupRegistered = true;
        const cleanupTaskListeners = attachPreviewTaskListeners(proxyServer, tasks);
        return async () => {
          cleanupTaskListeners();
          await proxyServer.close();
        };
      },
      formatStoppingMessage: (reason) => `Stopping bit-lite preview (${reason})...\n`,
    });
  } finally {
    if (!proxyCleanupRegistered) await proxyServer.close();
  }
}

function createPreviewTaskSpecs(workspace: WorkspaceRuntime, groups: SelectedEnvGroup[], parsed: ParsedCliArgs) {
  const tasks: PreviewTaskSpec[] = [];
  const skipped: PreviewSkippedEnv[] = [];
  for (const group of groups) {
    const serviceConfig = group.env.services[serviceId];
    if (serviceConfig === undefined) {
      skipped.push({
        envName: group.envName,
        reason: `services.${serviceId} is not configured`,
        components: group.components.map((component) => component.id),
      });
      continue;
    }
    tasks.push({
      envName: group.envName,
      components: group.components,
      serviceConfig,
      taskOptions: {
        envName: group.envName,
        components: group.components,
        args: parsed.args,
        context: workspace,
        serviceConfig,
      },
    });
  }
  return { tasks, skipped };
}

async function addPreviewRuntime(tasks: PreviewTaskSpec[], proxyOrigin: string, host: string) {
  const result: VendorTaskStartOptions[] = [];
  let nextPort = defaultVendorPort;
  for (const task of tasks) {
    const port = await findAvailablePort(host, nextPort);
    nextPort = port + 1;
    const runtime: PreviewVendorRuntime = {
      host,
      port,
      basePath: `/env/${encodeRouteSegment(task.envName)}/`,
      proxyOrigin,
    };
    result.push({ ...task.taskOptions, runtime });
  }
  return result;
}

function attachPreviewTaskListeners(proxyServer: PreviewProxyServer, tasks: VendorTask<unknown, PreviewServiceResult>[]) {
  const unsubscribers = tasks.map((task) => {
    proxyServer.updateTask(task.envName, {
      taskId: task.id,
      vendor: task.vendor.id,
      status: task.status,
    });
    return task.onMessage?.((message) => {
      proxyServer.updateTask(task.envName, {
        taskId: task.id,
        vendor: task.vendor.id,
        status: readTaskStatus(task, message),
      });
    });
  });
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe?.();
  };
}

function readTaskStatus(task: VendorTask<unknown, PreviewServiceResult>, message: VendorMessage<PreviewServiceResult>) {
  if (message.type === "result") return "ready";
  return task.status;
}

function formatPreviewResult(result: unknown, componentCounts: Map<string, number>) {
  if (!isPreviewServiceResult(result)) return new Error("Invalid preview result");
  const componentCount = componentCounts.get(result.envName) ?? 0;
  const componentLabel = componentCount === 1 ? "component" : "components";
  return [`${componentCount} ${componentLabel} ${result.server.origin}`];
}

function isPreviewServiceResult(value: unknown): value is PreviewServiceResult {
  return (
    isRecord(value) &&
    value.service === "preview" &&
    typeof value.vendor === "string" &&
    typeof value.envName === "string" &&
    value.mode === "serve" &&
    isPreviewServerInfo(value.server)
  );
}

function isPreviewServerInfo(value: unknown): value is PreviewServerInfo {
  return (
    isRecord(value) &&
    typeof value.origin === "string" &&
    typeof value.host === "string" &&
    typeof value.port === "number" &&
    typeof value.basePath === "string"
  );
}

function printNoPreviewTasks(groups: SelectedEnvGroup[]) {
  console.log("No preview tasks found.");
  if (groups.length === 0) {
    console.log("No components were selected from this workspace.");
    return;
  }
  console.log(`Selected envs: ${groups.map((group) => group.envName).join(", ")}`);
  console.log("Make sure each selected env defines services.preview in the workspace config.");
}

function readHost(value: CliOptionValue | undefined) {
  if (value === undefined) return defaultHost;
  if (typeof value !== "string" || value.length === 0) throw new BitLiteError("--host requires a host name");
  return value;
}

function readPort(value: CliOptionValue | undefined, optionName: string, fallback: number) {
  if (value === undefined) return fallback;
  const port = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BitLiteError(`${optionName} requires a port number between 1 and 65535`);
  }
  return port;
}

function readVendorLabel(serviceConfig: unknown) {
  if (!isRecord(serviceConfig) || typeof serviceConfig.vendor !== "string") return "unknown";
  return serviceConfig.vendor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

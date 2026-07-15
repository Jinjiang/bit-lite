import {
  getSelectedEnvKey,
  groupSelectedComponentsByEnv,
  isSelectedEnvIdentity,
  resolveEnvModuleSpecifier,
  selectComponentRefs,
  toSelectedEnvIdentity,
} from "bit-lite-context";
import { watchVendorTasks } from "bit-lite-vendors";
import { BitLiteError } from "../utils/errors.js";
import {
  PreviewProxyServer,
  encodeRouteSegment,
  findAvailablePort,
  preparePreviewEnv,
  type PreparedPreviewEnv,
  type PreviewComponentRef,
  type PreviewPreparedRuntime,
  type PreviewServerInfo,
  type PreviewSkippedEnv,
} from "bit-lite-preview/node";
import type {
  CliOptionValue,
  LoadedEnvServiceRuntime,
  ParsedCliArgs,
  SelectedEnvGroup,
  SelectedEnvIdentity,
  WorkspaceRuntime,
} from "bit-lite-context";
import type { EnvServiceConfig } from "bit-lite-env";
import type { JsonObject, VendorMessage, VendorTask, VendorTaskStartOptions } from "bit-lite-vendors";
import { prepareWorkspaceForEnvLoading } from "../prepare-workspace.js";

export type PreviewVendorRuntime = PreviewPreparedRuntime;

export type PreviewServiceResult = JsonObject & {
  service: "preview";
  vendor: string;
  env: SelectedEnvIdentity;
  mode: "serve";
  server: PreviewServerInfo;
};

export type PreviewTaskSpec = {
  env: SelectedEnvIdentity;
  components: PreviewComponentRef[];
  service: LoadedEnvServiceRuntime;
  taskOptions: VendorTaskStartOptions;
};

const serviceId = "preview";
const label = "Preview";
const defaultHost = "127.0.0.1";
const defaultProxyPort = 4000;
const defaultVendorPort = 6000;

export async function runPreviewCommand(parsed: ParsedCliArgs) {
  const { workspace } = await prepareWorkspaceForEnvLoading(parsed.workspaceRoot);
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
      env: task.env,
      taskId: getSelectedEnvKey(task.env),
      vendor: task.service.definition.vendor,
      status: "starting",
      components: task.components,
    })),
    skipped,
  });
  const proxy = await proxyServer.start(host, proxyPort);
  const preparedEnvs: PreparedPreviewEnv[] = [];
  let proxyCleanupRegistered = false;

  try {
    const prepared = await preparePreviewTasks(tasks, workspace.workspaceRoot, proxy.origin, host, proxyServer);
    preparedEnvs.push(...prepared.preparedEnvs);
    if (prepared.taskOptions.length === 0) {
      const failures = prepared.failures
        .map(({ env, error }) => `${env.packageName}: ${formatError(error)}`)
        .join("; ");
      throw new BitLiteError(`Preview preparation failed for every selected env${failures ? ` (${failures})` : ""}`);
    }
    const componentCounts = new Map(
      prepared.preparedEnvs.map((preparedEnv) => [getSelectedEnvKey(preparedEnv.env), preparedEnv.components.length])
    );
    console.log(`Preview: ${proxyServer.origin}`);
    await watchVendorTasks<PreviewServiceResult>(prepared.taskOptions, {
      serviceId,
      label,
      title: () => `Preview: ${proxyServer.origin}`,
      formatResult(result) {
        return formatPreviewResult(result, componentCounts);
      },
      onResult(result, task) {
        proxyServer.updateServer(task.env, result.server, result.vendor);
      },
      onTasksStarted(tasks) {
        proxyCleanupRegistered = true;
        const cleanupTaskListeners = attachPreviewTaskListeners(proxyServer, tasks);
        return async () => {
          cleanupTaskListeners();
          await proxyServer.close();
          await Promise.all(prepared.preparedEnvs.map((preparedEnv) => preparedEnv.cleanup()));
        };
      },
      formatStoppingMessage: (reason) => `Stopping bit-lite preview (${reason})...\n`,
    });
  } finally {
    if (!proxyCleanupRegistered) await proxyServer.close();
    await Promise.all(preparedEnvs.map((preparedEnv) => preparedEnv.cleanup()));
  }
}

function createPreviewTaskSpecs(
  workspace: WorkspaceRuntime,
  groups: SelectedEnvGroup[],
  parsed: ParsedCliArgs
) {
  const tasks: PreviewTaskSpec[] = [];
  const skipped: PreviewSkippedEnv[] = [];
  for (const group of groups) {
    const serviceConfig = group.env.services[serviceId];
    if (serviceConfig === undefined) {
      skipped.push({
        env: toSelectedEnvIdentity(group.env),
        reason: `services.${serviceId} is not configured`,
        components: group.components.map((component) => component.id),
      });
      continue;
    }
    const components = group.components.map(({ id, rootDir, packageName }) => ({ id, rootDir, packageName }));
    tasks.push({
      env: toSelectedEnvIdentity(group.env),
      components,
      service: serviceConfig,
      taskOptions: {
        env: toSelectedEnvIdentity(group.env),
        components,
        args: parsed.args,
        workspaceRoot: workspace.workspaceRoot,
        service: serviceConfig,
      },
    });
  }
  return { tasks, skipped };
}

export async function preparePreviewTasks(
  tasks: PreviewTaskSpec[],
  workspaceRoot: string,
  proxyOrigin: string,
  host: string,
  proxyServer: PreviewProxyServer
) {
  const taskOptions: VendorTaskStartOptions[] = [];
  const preparedEnvs: PreparedPreviewEnv[] = [];
  const failures: Array<{ env: SelectedEnvIdentity; error: unknown }> = [];
  let nextPort = defaultVendorPort;
  for (const task of tasks) {
    const port = await findAvailablePort(host, nextPort);
    nextPort = port + 1;
    const server = {
      host,
      port,
      basePath: `/env/${encodeRouteSegment(task.env.packageName)}/`,
      proxyOrigin,
    };
    try {
      const prepared = await preparePreviewEnv({
        env: task.env,
        components: task.components,
        serviceConfig: task.service.definition,
        workspaceRoot,
        server,
        resolveModule(specifier, field) {
          return resolveEnvModuleSpecifier({
            specifier,
            service: task.service,
            workspaceRoot,
            field: `preview config.${field}`,
            selectedEnv: task.env.packageName,
          });
        },
      });
      preparedEnvs.push(prepared);
      proxyServer.updatePreparedComponents(task.env, server.basePath, prepared.components);
      taskOptions.push({
        ...task.taskOptions,
        components: [],
        workspaceRoot,
        service: {
          ...task.service,
          definition: prepared.serviceConfig as EnvServiceConfig,
        },
        runtime: prepared.runtime,
      });
    } catch (error) {
      failures.push({ env: task.env, error });
      proxyServer.updatePreparationFailure(task.env, error);
    }
  }
  return { taskOptions, preparedEnvs, failures };
}

function attachPreviewTaskListeners(proxyServer: PreviewProxyServer, tasks: VendorTask<unknown, PreviewServiceResult>[]) {
  const unsubscribers = tasks.map((task) => {
    proxyServer.updateTask(task.env, {
      taskId: task.id,
      vendor: task.vendor.id,
      status: task.status,
    });
    return task.onMessage?.((message) => {
      proxyServer.updateTask(task.env, {
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
  const componentCount = componentCounts.get(getSelectedEnvKey(result.env)) ?? 0;
  const componentLabel = componentCount === 1 ? "component" : "components";
  return [`${componentCount} ${componentLabel} ${result.server.origin}`];
}

export function isPreviewServiceResult(value: unknown): value is PreviewServiceResult {
  return (
    isRecord(value) &&
    value.service === "preview" &&
    typeof value.vendor === "string" &&
    !("envName" in value) &&
    isSelectedEnvIdentity(value.env) &&
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
  console.log(`Selected envs: ${groups.map((group) => group.env.packageName).join(", ")}`);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

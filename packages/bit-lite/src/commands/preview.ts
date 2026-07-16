import {
  getSelectedEnvKey,
  groupWorkspaceComponentsByEnv,
  resolveEnvModuleSpecifier,
  resolveVendorSpecifier,
  selectWorkspaceComponents,
} from "bit-lite-context";
import { createVendorContext, watchVendorTasks } from "bit-lite-vendors";
import { BitLiteError } from "../utils/errors.js";
import {
  PreviewProxyServer,
  encodeRouteSegment,
  findAvailablePort,
  preparePreviewEnv,
  type PreparedPreviewEnv,
  type PreviewPreparedRuntime,
  type PreviewServerInfo,
} from "bit-lite-preview/node";
import type {
  CliArguments,
  CliOptionValue,
  EnvContext,
  ParsedCliArgs,
  Workspace,
  WorkspaceEnvGroup,
} from "bit-lite-context";
import type {
  JsonObject,
  VendorMessage,
  VendorTask,
  VendorTaskStartOptions,
} from "bit-lite-vendors";
import { prepareWorkspaceForEnvLoading } from "../utils/prepare-workspace.js";

export type PreviewVendorRuntime = PreviewPreparedRuntime;
export type PreviewServiceResult = JsonObject & { mode: "serve" };

type PreparedPreviewTask = {
  options: VendorTaskStartOptions;
  prepared: PreparedPreviewEnv;
};

const serviceId = "preview";
const label = "Preview";
const defaultHost = "127.0.0.1";
const defaultProxyPort = 4000;
const defaultVendorPort = 6000;

export async function runPreviewCommand(parsed: ParsedCliArgs) {
  // 0. resolve inputs
  const { workspace, context } = await prepareWorkspaceForEnvLoading(parsed.workspaceRoot);
  const components = selectWorkspaceComponents(workspace, parsed.componentFilters);
  const groups = groupWorkspaceComponentsByEnv(context, components);
  const previewGroups = groups.filter((group) => group.env.services.preview !== undefined);

  if (previewGroups.length === 0) {
    printNoPreviewTasks(groups);
    return;
  }

  // 1. initialize the proxy server
  const host = readHost(parsed.args.options.host);
  const proxyPort = readPort(parsed.args.options.port, "--port", defaultProxyPort);
  const proxyServer = new PreviewProxyServer({
    envs: previewGroups.map((group) => ({
      env: group.env.env,
      taskId: getSelectedEnvKey(group.env.env),
      vendor: getPreviewService(group).definition.vendor,
      status: "starting",
      components: group.components,
    })),
  });
  const proxy = await proxyServer.start(host, proxyPort);
  let preparedTasks: PreparedPreviewTask[] = [];
  let proxyCleanupRegistered = false;

  try {
    // 2. prepare tasks with resolving vendors and configs
    const prepared = await preparePreviewTasks(
      previewGroups,
      workspace,
      parsed.args,
      proxy.origin,
      host,
      proxyServer
    );
    preparedTasks = prepared.tasks;
    if (prepared.tasks.length === 0) {
      const failures = prepared.failures
        .map(({ env, error }) => `${env.env.packageName}: ${formatError(error)}`)
        .join("; ");
      throw new BitLiteError(`Preview preparation failed for every selected env${failures ? ` (${failures})` : ""}`);
    }
    const preparedByEnv = new Map(
      prepared.tasks.map((task) => [getSelectedEnvKey(task.prepared.env), task.prepared])
    );

    // 3. start watch vendor tasks and manage the communications
    console.log(`Preview: ${proxyServer.origin}`);
    await watchVendorTasks<PreviewServiceResult>(prepared.tasks.map((task) => task.options), {
      serviceId,
      label,
      title: () => `Preview: ${proxyServer.origin}`,
      formatResult: formatPreviewResult,
      onResult(_result, task) {
        const preparedEnv = preparedByEnv.get(getSelectedEnvKey(task.context.env));
        if (!preparedEnv) return;
        proxyServer.updateServer(
          task.context.env,
          toPreviewServerInfo(preparedEnv.runtime),
          task.vendor.id
        );
      },
      onTasksStarted(startedTasks) {
        proxyCleanupRegistered = true;
        const cleanupTaskListeners = attachPreviewTaskListeners(proxyServer, startedTasks);
        return async () => {
          cleanupTaskListeners();
          await proxyServer.close();
          await Promise.all(prepared.tasks.map((task) => task.prepared.cleanup()));
        };
      },
      formatStoppingMessage: (reason) => `Stopping bit-lite preview (${reason})...\n`,
    });
  } finally {
    if (!proxyCleanupRegistered) await proxyServer.close();
    await Promise.all(preparedTasks.map((task) => task.prepared.cleanup()));
  }
}

export async function preparePreviewTasks(
  groups: WorkspaceEnvGroup[],
  workspace: Workspace,
  args: CliArguments,
  proxyOrigin: string,
  host: string,
  proxyServer: PreviewProxyServer
) {
  const tasks: PreparedPreviewTask[] = [];
  const failures: Array<{ env: EnvContext; error: unknown }> = [];
  let nextPort = defaultVendorPort;
  for (const group of groups) {
    const service = getPreviewService(group);
    try {
      // 0. resolve vendor and server info
      const vendorUrl = await resolveVendorSpecifier({
        specifier: service.definition.vendor,
        service,
        workspaceRoot: workspace.rootDir,
        selectedEnv: group.env.env.packageName,
        serviceName: serviceId,
      });
      const port = await findAvailablePort(host, nextPort);
      nextPort = port + 1;
      const server = {
        host,
        port,
        basePath: `/env/${encodeRouteSegment(group.env.env.packageName)}/`,
        proxyOrigin,
      };

      // 1. resolve preview config details
      const prepared = await preparePreviewEnv({
        env: group.env.env,
        components: group.components,
        config: service.definition.config ?? {},
        workspaceRoot: workspace.rootDir,
        server,
        resolveModule(specifier, field) {
          return resolveEnvModuleSpecifier({
            specifier,
            service,
            workspaceRoot: workspace.rootDir,
            field: `preview config.${field}`,
            selectedEnv: group.env.env.packageName,
          });
        },
      });

      // 2. update components of the env to proxy server
      proxyServer.updatePreparedComponents(group.env.env, server.basePath, prepared.components);

      // 3. add to the final tasks (or failures)
      tasks.push({
        prepared,
        options: {
          vendorUrl,
          context: createVendorContext({ workspace, args, env: group.env, service }),
          components: group.components,
          config: prepared.config as JsonObject,
          runtime: prepared.runtime,
        },
      });
    } catch (error) {
      failures.push({ env: group.env, error });
      proxyServer.updatePreparationFailure(group.env.env, error);
    }
  }
  return { tasks, failures };
}

function getPreviewService(group: WorkspaceEnvGroup) {
  const service = group.env.services.preview;
  if (!service) throw new BitLiteError(`selected env "${group.env.env.packageName}" does not define services.preview`);
  return service;
}

function attachPreviewTaskListeners(
  proxyServer: PreviewProxyServer,
  tasks: VendorTask<unknown, PreviewServiceResult>[]
) {
  const unsubscribers = tasks.map((task) => {
    proxyServer.updateTask(task.context.env, {
      taskId: task.id,
      vendor: task.vendor.id,
      status: task.status,
    });
    return task.onMessage?.((message) => {
      proxyServer.updateTask(task.context.env, {
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

function readTaskStatus(
  task: VendorTask<unknown, PreviewServiceResult>,
  message: VendorMessage<PreviewServiceResult>
) {
  if (message.type === "result") return "ready";
  return task.status;
}

function formatPreviewResult(result: unknown) {
  if (!isPreviewServiceResult(result)) return new Error("Invalid preview result");
  return ["Preview ready"];
}

export function isPreviewServiceResult(value: unknown): value is PreviewServiceResult {
  return isJsonObject(value) && value.mode === "serve";
}

function toPreviewServerInfo(runtime: PreviewPreparedRuntime): PreviewServerInfo {
  return {
    origin: `http://${runtime.server.host}:${runtime.server.port}`,
    host: runtime.server.host,
    port: runtime.server.port,
    basePath: runtime.server.basePath,
  };
}

function printNoPreviewTasks(groups: WorkspaceEnvGroup[]) {
  console.log("No preview tasks found.");
  if (groups.length === 0) {
    console.log("No components were selected from this workspace.");
    return;
  }
  console.log(`Selected envs: ${groups.map((group) => group.env.env.packageName).join(", ")}`);
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

function isJsonObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonObject[keyof JsonObject] {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

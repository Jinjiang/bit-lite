import {
  getSelectedEnvKey,
  resolveEnvModuleSpecifier,
  resolveVendorSpecifier,
} from "bit-lite-context";
import { ProxyServer } from "bit-lite-proxy";
import {
  createVendorContext,
  createWatchVendorTasks,
  stopVendorTasks,
  superviseVendorTasks,
} from "bit-lite-vendors";
import { BitLiteError } from "../utils/errors.js";
import {
  createPreviewPresentationRoutes,
  createPreviewServiceRoutes,
  encodeRouteSegment,
  findAvailablePort,
  preparePreviewEnv,
  PreviewProxyState,
  type PreparedPreviewEnv,
  type PreviewPreparedRuntime,
  type PreviewServerInfo,
} from "bit-lite-preview/node";
import type {
  CliArguments,
  CliOptionValue,
  EnvContext,
  ParsedCliArgs,
  SelectedEnvIdentity,
  Workspace,
  WorkspaceEnvGroup,
} from "bit-lite-context";
import type { ProxyEndpoint } from "bit-lite-proxy";
import type {
  JsonObject,
  VendorMessage,
  VendorTask,
  VendorTaskStartOptions,
} from "bit-lite-vendors";
import { prepareResolvedCommandSelection } from "../utils/command-selection.js";
import type { ResolvedCommandSelection } from "../utils/command-selection.js";
import type { WatchCommandContribution } from "./watch-contribution.js";

export type PreviewVendorRuntime = PreviewPreparedRuntime;
export type PreviewServiceResult = JsonObject & { mode: "serve" };

type PreparedPreviewTask = {
  options: VendorTaskStartOptions;
  prepared: PreparedPreviewEnv;
};

export type PreviewUnavailableGroup = {
  env: SelectedEnvIdentity;
  reason: string;
  componentIds: string[];
};

export type PreviewCommandContribution = WatchCommandContribution<VendorTask<unknown, PreviewServiceResult>> & {
  state: PreviewProxyState;
  groups: readonly WorkspaceEnvGroup[];
  configuredTaskCount: number;
  unavailable: PreviewUnavailableGroup[];
  preparationFailures: Array<{ env: EnvContext; error: unknown }>;
  manifest(): ReturnType<PreviewProxyState["manifest"]>;
};

export type CreatePreviewCommandContributionOptions = {
  proxy: ProxyEndpoint;
  host?: string | undefined;
};

type PreviewStateWriter = Pick<
  PreviewProxyState,
  "updatePreparedComponents" | "updatePreparationFailure"
>;

const serviceId = "preview";
const label = "Preview";
const defaultHost = "127.0.0.1";
const defaultProxyPort = 4000;
const defaultVendorPort = 6000;

export async function runPreviewCommand(parsed: ParsedCliArgs) {
  const selection = await prepareResolvedCommandSelection(parsed);
  const previewGroups = selection.groups.filter((group) => group.env.services.preview !== undefined);
  if (previewGroups.length === 0) {
    printNoPreviewTasks(selection.groups);
    return;
  }

  const host = readHost(parsed.args.options.host);
  const proxyPort = readPort(parsed.args.options.port, "--port", defaultProxyPort);
  const proxyServer = new ProxyServer();
  let contribution: PreviewCommandContribution | undefined;
  let disposed = false;

  const disposeResources = async () => {
    if (disposed) return;
    disposed = true;
    await contribution?.dispose();
    await proxyServer.close();
  };

  try {
    const proxy = await proxyServer.start(host, proxyPort);
    contribution = await createPreviewCommandContribution(selection, { proxy, host });

    try {
      proxyServer.addRoutes(createPreviewPresentationRoutes(contribution.state));
      proxyServer.addRoutes(contribution.routes);
    } catch (error) {
      await stopVendorTasks(contribution.tasks);
      throw error;
    }

    if (contribution.tasks.length === 0) {
      const failures = contribution.preparationFailures
        .map(({ env, error }) => `${env.env.packageName}: ${formatError(error)}`)
        .join("; ");
      throw new BitLiteError(`Preview preparation failed for every selected env${failures ? ` (${failures})` : ""}`);
    }

    console.log(`Preview: ${proxyServer.origin}`);
    await superviseVendorTasks(contribution.tasks, {
      title: () => `Preview: ${proxyServer.origin}`,
      formatStoppingMessage: (reason) => `Stopping bit-lite preview (${reason})...\n`,
      onTasksStarted() {
        return disposeResources;
      },
    });
  } finally {
    await disposeResources();
  }
}

export async function createPreviewCommandContribution(
  selection: ResolvedCommandSelection,
  options: CreatePreviewCommandContributionOptions
): Promise<PreviewCommandContribution> {
  const groups = selection.groups;
  const previewGroups = groups.filter((group) => group.env.services.preview !== undefined);
  const unavailable = groups
    .filter((group) => group.env.services.preview === undefined)
    .map((group) => ({
      env: group.env.env,
      reason: "services.preview is not configured",
      componentIds: group.components.map((component) => component.id),
    }));
  const state = new PreviewProxyState({
    envs: previewGroups.map((group) => ({
      env: group.env.env,
      taskId: `${serviceId}:${getSelectedEnvKey(group.env.env)}`,
      vendor: getPreviewService(group).definition.vendor,
      status: "starting",
      components: group.components,
    })),
  });
  const prepared = await preparePreviewTasks(
    previewGroups,
    selection.context.workspace,
    selection.parsed.args,
    options.proxy.origin,
    options.host ?? options.proxy.host,
    state
  );
  const preparedByEnv = new Map(
    prepared.tasks.map((task) => [getSelectedEnvKey(task.prepared.env), task.prepared])
  );
  let tasks: VendorTask<unknown, PreviewServiceResult>[] = [];
  let cleanupListeners: (() => void) | undefined;
  let disposed = false;

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    cleanupListeners?.();
    await Promise.all(prepared.tasks.map((task) => task.prepared.cleanup()));
  };

  try {
    tasks = await createWatchVendorTasks<PreviewServiceResult>(
      prepared.tasks.map((task) => task.options),
      {
        serviceId,
        label,
        formatResult: formatPreviewResult,
        onResult(_result, task) {
          const preparedEnv = preparedByEnv.get(getSelectedEnvKey(task.context.env));
          if (!preparedEnv) return;
          state.updateServer(task.context.env, toPreviewServerInfo(preparedEnv.runtime), task.vendor.id);
        },
      }
    );
    cleanupListeners = attachPreviewTaskListeners(state, tasks);
  } catch (error) {
    await dispose();
    throw error;
  }

  return {
    serviceId,
    tasks,
    routes: createPreviewServiceRoutes(state),
    state,
    groups,
    configuredTaskCount: previewGroups.length,
    unavailable,
    preparationFailures: prepared.failures,
    manifest: () => state.manifest(options.proxy),
    dispose,
  };
}

export async function preparePreviewTasks(
  groups: readonly WorkspaceEnvGroup[],
  workspace: Workspace,
  args: CliArguments,
  proxyOrigin: string,
  host: string,
  state: PreviewStateWriter
) {
  const tasks: PreparedPreviewTask[] = [];
  const failures: Array<{ env: EnvContext; error: unknown }> = [];
  let nextPort = defaultVendorPort;
  for (const group of groups) {
    const service = getPreviewService(group);
    try {
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

      state.updatePreparedComponents(group.env.env, server.basePath, prepared.components);
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
      state.updatePreparationFailure(group.env.env, error);
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
  state: PreviewProxyState,
  tasks: VendorTask<unknown, PreviewServiceResult>[]
) {
  const unsubscribers = tasks.map((task) => {
    state.updateTask(task.context.env, {
      taskId: task.id,
      vendor: task.vendor.id,
      status: task.status,
    });
    return task.onMessage?.((message) => {
      state.updateTask(task.context.env, {
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

function printNoPreviewTasks(groups: readonly WorkspaceEnvGroup[]) {
  console.log("No preview tasks found.");
  if (groups.length === 0) {
    console.log("No components were selected from this workspace.");
    return;
  }
  console.log(`Selected envs: ${groups.map((group) => group.env.env.packageName).join(", ")}`);
  console.log("Make sure each selected env defines services.preview in the workspace config.");
}

export function readPreviewHost(value: CliOptionValue | undefined) {
  if (value === undefined) return defaultHost;
  if (typeof value !== "string" || value.length === 0) throw new BitLiteError("--host requires a host name");
  return value;
}

export function readPreviewPort(value: CliOptionValue | undefined, optionName: string, fallback: number) {
  if (value === undefined) return fallback;
  const port = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BitLiteError(`${optionName} requires a port number between 1 and 65535`);
  }
  return port;
}

function readHost(value: CliOptionValue | undefined) {
  return readPreviewHost(value);
}

function readPort(value: CliOptionValue | undefined, optionName: string, fallback: number) {
  return readPreviewPort(value, optionName, fallback);
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

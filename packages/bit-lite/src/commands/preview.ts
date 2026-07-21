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
export type PreviewServiceResult = JsonObject & { mode: "serve"; port: number };
export type PreviewActivationMode = "eager" | "lazy";

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
  activationMode?: PreviewActivationMode | undefined;
};

type PreviewStateWriter = Pick<
  PreviewProxyState,
  "updatePreparedComponents" | "updatePreparationFailure" | "updatePortHints"
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
  const activationMode = readPreviewLazy(parsed.args.options.lazy) ? "lazy" : "eager";
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
    contribution = await createPreviewCommandContribution(selection, { proxy, host, activationMode });

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
  const activationMode = options.activationMode ?? "eager";
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
      status: activationMode === "lazy" ? "idle" : "starting",
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
  let tasks: VendorTask<unknown, PreviewServiceResult>[] = [];
  let cleanupListeners: (() => void) | undefined;
  const resultsByEnv = new Map<string, PreviewServiceResult>();
  let disposed = false;

  try {
    tasks = await createWatchVendorTasks<PreviewServiceResult>(
      prepared.tasks.map((task) => task.options),
      {
        serviceId,
        label,
        activation: "deferred",
        formatResult: formatPreviewResult,
        onResult(result, task) {
          resultsByEnv.set(getSelectedEnvKey(task.context.env), result);
        },
      }
    );
    for (const task of tasks) void task.result.catch(() => undefined);
    cleanupListeners = attachPreviewTaskListeners(state, tasks);
  } catch (error) {
    cleanupListeners?.();
    await stopVendorTasks(tasks);
    await Promise.all(prepared.tasks.map((task) => task.prepared.cleanup()));
    throw error;
  }

  const preparedByEnv = new Map(
    prepared.tasks.map((task) => [getSelectedEnvKey(task.prepared.env), task.prepared])
  );
  const tasksByEnv = new Map(tasks.map((task) => [getSelectedEnvKey(task.context.env), task]));
  const activationPromises = new Map<string, Promise<PreviewServerInfo>>();

  const ensureStarted = (env: SelectedEnvIdentity) => {
    const key = getSelectedEnvKey(env);
    const existing = activationPromises.get(key);
    if (existing) return existing;
    if (disposed) return Promise.reject(new Error(`Preview env "${env.packageName}" has stopped`));
    const task = tasksByEnv.get(key);
    const preparedEnv = preparedByEnv.get(key);
    if (!task || !preparedEnv) {
      return Promise.reject(new Error(`Preview env "${env.packageName}" is not prepared`));
    }

    state.updateTask(env, { status: "starting" });
    const activation = (async () => {
      try {
        await task.activate();
        if (disposed) throw new Error(`Preview env "${env.packageName}" stopped during activation`);
        const result = resultsByEnv.get(key);
        if (!result) {
          throw new Error(`Preview vendor "${task.vendor.id}" did not report a valid actual port`);
        }
        const server = toPreviewServerInfo(preparedEnv.runtime, result);
        state.updateServer(env, server, task.vendor.id);
        return server;
      } catch (error) {
        if (!disposed) state.updateActivationFailure(env, error);
        await Promise.resolve(task.stop()).catch(() => undefined);
        throw error;
      }
    })();
    activationPromises.set(key, activation);
    return activation;
  };

  if (activationMode === "eager") {
    for (const task of tasks) void ensureStarted(task.context.env).catch(() => undefined);
  }

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await stopVendorTasks(tasks);
    for (const task of tasks) state.updateTask(task.context.env, { status: "stopped" });
    cleanupListeners?.();
    await Promise.all(prepared.tasks.map((task) => task.prepared.cleanup()));
  };

  return {
    serviceId,
    tasks,
    routes: createPreviewServiceRoutes(state, { ensureStarted }),
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
  const sortedGroups = [...groups].sort((left, right) =>
    getSelectedEnvKey(left.env.env).localeCompare(getSelectedEnvKey(right.env.env))
  );
  for (const group of sortedGroups) {
    const service = getPreviewService(group);
    try {
      const vendorUrl = await resolveVendorSpecifier({
        specifier: service.definition.vendor,
        service,
        workspaceRoot: workspace.rootDir,
        selectedEnv: group.env.env.packageName,
        serviceName: serviceId,
      });
      const server = {
        host,
        preferredPort: defaultVendorPort,
        fallbackStartPort: defaultVendorPort,
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

  let portHints: ReturnType<typeof createPreviewPortHints>;
  try {
    portHints = createPreviewPortHints(tasks.length);
  } catch (error) {
    for (const task of tasks) state.updatePreparationFailure(task.prepared.env, error);
    await Promise.all(tasks.map((task) => task.prepared.cleanup()));
    throw error;
  }
  tasks.forEach((task, index) => {
    const hints = portHints[index]!;
    task.prepared.runtime.server.preferredPort = hints.preferredPort;
    task.prepared.runtime.server.fallbackStartPort = hints.fallbackStartPort;
    state.updatePortHints(task.prepared.env, hints);
  });
  return { tasks, failures };
}

export function createPreviewPortHints(count: number, basePort = defaultVendorPort) {
  if (!Number.isInteger(count) || count < 0) {
    throw new BitLiteError("preview env count must be a non-negative integer");
  }
  if (!Number.isInteger(basePort) || basePort <= 0 || basePort > 65535) {
    throw new BitLiteError("preview base port must be an integer between 1 and 65535");
  }
  const fallbackStartPort = basePort + count;
  if (fallbackStartPort > 65535) {
    throw new BitLiteError(
      `preview port range is exhausted: ${count} envs from base port ${basePort} leave no fallback port`
    );
  }
  return Array.from({ length: count }, (_, index) => ({
    preferredPort: basePort + index,
    fallbackStartPort,
  }));
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
      if (state.findEnvByPackageName(task.context.env.packageName)?.status === "failed") return;
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
  if (message.type === "result" || message.type === "ready") return "starting";
  if (message.type === "status" && message.status === "ready") return "starting";
  return task.status;
}

function formatPreviewResult(result: unknown) {
  if (!isPreviewServiceResult(result)) return new Error("Invalid preview result");
  return [`Preview ready on port ${result.port}`];
}

export function isPreviewServiceResult(value: unknown): value is PreviewServiceResult {
  return isJsonObject(value) && value.mode === "serve" &&
    typeof value.port === "number" && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535;
}

function toPreviewServerInfo(runtime: PreviewPreparedRuntime, result: PreviewServiceResult): PreviewServerInfo {
  return {
    origin: `http://${runtime.server.host}:${result.port}`,
    host: runtime.server.host,
    port: result.port,
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

export function readPreviewLazy(value: CliOptionValue | undefined) {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  throw new BitLiteError("--lazy requires a boolean value");
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

import {
  getSelectedEnvKey,
  resolveEnvModuleSpecifier,
} from "bit-lite-context";
import { ProxyServer } from "bit-lite-proxy";
import { superviseVendorTasks } from "bit-lite-vendors";
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
} from "bit-lite-vendors";
import { prepareResolvedCommandSelection } from "../utils/command-selection.js";
import type { ResolvedCommandSelection } from "../utils/command-selection.js";
import {
  createEnvServiceExecutionPlan,
  createVendorWatchExecution,
  defineVendorExecution,
  prepareResolvedServiceTaskOptions,
} from "../utils/vendor-execution.js";
import type {
  ImmutableCliArguments,
  PlannedEnvServiceUnit,
  PlannedUnit,
} from "../utils/vendor-execution.js";
import type { WatchCommandContribution } from "../utils/watch-contribution.js";

export type PreviewVendorRuntime = PreviewPreparedRuntime;
export type PreviewServiceResult = JsonObject & { mode: "serve"; port: number };
export type PreviewActivationMode = "eager" | "lazy";

export type PreviewCommandContribution = WatchCommandContribution<VendorTask<unknown, PreviewServiceResult>> & {
  state: PreviewProxyState;
  groups: readonly WorkspaceEnvGroup[];
  configuredTaskCount: number;
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

type PreviewExecutionContext = {
  workspace: Workspace;
  proxyOrigin: string;
  host: string;
  state: PreviewStateWriter;
};

const previewVendorExecution = defineVendorExecution<
  PlannedEnvServiceUnit,
  PreviewExecutionContext,
  PreparedPreviewEnv,
  never,
  PreviewServiceResult
>({
  serviceId,
  label,
  prepare: preparePreviewUnit,
  cleanupPrepared(prepared) {
    return prepared.metadata?.cleanup();
  },
  watch: {
    activation: "deferred",
    formatResult: formatPreviewResult,
    finalizePreparedLayer: finalizePreparedPreviewLayer,
  },
});

export async function runPreviewCommand(parsed: ParsedCliArgs) {
  const selection = await prepareResolvedCommandSelection(parsed);
  const plan = createEnvServiceExecutionPlan(selection, serviceId);
  if (plan.layers[0]?.length === 0) {
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
      await contribution.dispose();
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
  const plan = createEnvServiceExecutionPlan(selection, serviceId);
  const plannedUnits = plan.layers[0] ?? [];
  const unitIdByEnv = new Map(
    plannedUnits.map(({ id, value }) => [getSelectedEnvKey(value.group.env.env), id])
  );
  const state = new PreviewProxyState({
    envs: plannedUnits.map(({ id, value }) => ({
      env: value.group.env.env,
      taskId: id,
      vendor: value.service.definition.vendor,
      status: activationMode === "lazy" ? "idle" : "starting",
      components: value.group.components,
    })),
  });
  const execution = await createVendorWatchExecution({
    plan,
    definition: previewVendorExecution,
    context: {
      workspace: selection.context.workspace,
      proxyOrigin: options.proxy.origin,
      host: options.host ?? options.proxy.host,
      state,
    },
    args: selection.parsed.args,
  });
  const tasks = execution.tasks;
  let cleanupListeners: (() => void) | undefined;
  let disposed = false;

  try {
    cleanupListeners = attachPreviewTaskListeners(state, tasks);
  } catch (error) {
    cleanupListeners?.();
    await execution.dispose();
    throw error;
  }

  const ensureStarted = async (env: SelectedEnvIdentity) => {
    const key = getSelectedEnvKey(env);
    const unitId = unitIdByEnv.get(key);
    if (!unitId) throw new Error(`Preview env "${env.packageName}" is not configured`);
    state.updateTask(env, { status: "starting" });
    try {
      const { prepared, task, result } = await execution.ensureUnitReady(unitId);
      if (!prepared.metadata) {
        throw new Error(`Preview env "${env.packageName}" has no prepared metadata`);
      }
      const server = toPreviewServerInfo(prepared.metadata.runtime, result);
      state.updateServer(env, server, task.vendor.id);
      return server;
    } catch (error) {
      if (!disposed) state.updateActivationFailure(env, error);
      throw error;
    }
  };

  if (activationMode === "eager") {
    for (const task of tasks) void ensureStarted(task.context.env).catch(() => undefined);
  }

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await execution.dispose();
    for (const task of tasks) state.updateTask(task.context.env, { status: "stopped" });
    cleanupListeners?.();
  };

  return {
    serviceId,
    tasks,
    routes: createPreviewServiceRoutes(state, { ensureStarted }),
    state,
    groups,
    configuredTaskCount: plannedUnits.length,
    preparationFailures: execution.preparationFailures.map(({ unit, error }) => ({
      env: unit.value.group.env,
      error,
    })),
    manifest: () => state.manifest(options.proxy),
    dispose,
  };
}

async function preparePreviewUnit(options: {
  unit: PlannedUnit<PlannedEnvServiceUnit>;
  args: ImmutableCliArguments;
  mode: "run" | "watch";
  context: PreviewExecutionContext;
}) {
  const { group, service } = options.unit.value;
  const { workspace, proxyOrigin, host, state } = options.context;
  try {
    const taskOptions = await prepareResolvedServiceTaskOptions({
      workspace,
      args: options.args,
      unit: options.unit.value,
      taskId: options.unit.id,
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
    return {
      taskOptions: {
        ...taskOptions,
        config: prepared.config as JsonObject,
        runtime: prepared.runtime,
      },
      metadata: prepared,
    };
  } catch (error) {
    state.updatePreparationFailure(group.env.env, error);
    throw error;
  }
}

async function finalizePreparedPreviewLayer(
  items: readonly {
    unit: PlannedUnit<PlannedEnvServiceUnit>;
    prepared: {
      metadata?: PreparedPreviewEnv | undefined;
    };
  }[],
  context: PreviewExecutionContext
) {
  let portHints: ReturnType<typeof createPreviewPortHints>;
  try {
    portHints = createPreviewPortHints(items.length);
  } catch (error) {
    for (const item of items) {
      if (item.prepared.metadata) {
        context.state.updatePreparationFailure(item.prepared.metadata.env, error);
      }
    }
    throw error;
  }
  items.forEach((item, index) => {
    const prepared = item.prepared.metadata;
    if (!prepared) throw new Error(`Preview unit "${item.unit.id}" has no prepared metadata`);
    const hints = portHints[index]!;
    prepared.runtime.server.preferredPort = hints.preferredPort;
    prepared.runtime.server.fallbackStartPort = hints.fallbackStartPort;
    context.state.updatePortHints(prepared.env, hints);
  });
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

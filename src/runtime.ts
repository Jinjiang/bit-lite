import { BitLiteError } from "./utils/errors.js";
import { loadServicesForEnv } from "./services.js";
import type { ServiceEventListener, ServiceResult, ServiceRunResult, ServiceTask, WorkspaceRuntime } from "./types/index.js";

export type ServiceRunEventContext = {
  envName: string;
  serviceName: string;
  serviceRef: string;
};

export type RunServiceOptions = {
  args?: unknown | ((context: ServiceRunEventContext) => unknown);
  signal?: AbortSignal;
  execution?: "sequential" | "parallel";
  onEvent?: (type: string, payload: unknown, context: ServiceRunEventContext) => void;
  onTask?: (task: ServiceTask, context: ServiceRunEventContext) => void;
};

type RunnableGroup = {
  group: WorkspaceRuntime["groups"][number];
  runnable: Awaited<ReturnType<typeof loadServicesForEnv>>[number];
};

export type { RunnableGroup };

export function createServiceTask<Result extends ServiceResult>(
  run: (host: {
    signal: AbortSignal;
    emit(type: string, payload: unknown): void;
  }) => Promise<Result>,
  onCall?: (type: string, payload?: unknown) => void
): ServiceTask<Result> {
  const controller = new AbortController();
  const listeners = new Set<ServiceEventListener>();
  const emit = (type: string, payload: unknown) => {
    for (const listener of listeners) {
      listener(type, payload);
    }
  };
  const result = Promise.resolve().then(() => run({ signal: controller.signal, emit }));
  return {
    result,
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    abort() {
      controller.abort();
    },
    call(type, payload) {
      onCall?.(type, payload);
    },
  };
}

export async function runService(
  workspace: WorkspaceRuntime,
  serviceName: string,
  options: RunServiceOptions = {}
): Promise<ServiceRunResult[]> {
  const runnableGroups = await resolveRunnableGroups(workspace, serviceName);
  return runRunnableGroups(runnableGroups, {
    ...options,
    workspaceRoot: workspace.workspaceRoot,
  });
}

export async function resolveRunnableGroups(workspace: WorkspaceRuntime, serviceName: string): Promise<RunnableGroup[]> {
  const runnableGroups: RunnableGroup[] = [];

  for (const group of workspace.groups) {
    const services = await loadServicesForEnv(workspace.workspaceRoot, group.env.services);
    const runnable = services.find(({ serviceRef, service }) => serviceRef === serviceName || service.name === serviceName);
    if (!runnable) continue;
    runnableGroups.push({ group, runnable });
  }

  if (runnableGroups.length === 0) {
    throw new BitLiteError(`service "${serviceName}" is not configured for any discovered env`);
  }

  return runnableGroups;
}

export type RunRunnableGroupOptions = RunServiceOptions & {
  workspaceRoot: string;
};

export async function runRunnableGroup(
  { group, runnable }: RunnableGroup,
  options: RunRunnableGroupOptions
): Promise<ServiceRunResult> {
  const eventContext = {
    envName: group.envName,
    serviceName: runnable.service.name,
    serviceRef: runnable.serviceRef,
  };
  const args = typeof options.args === "function" ? options.args(eventContext) : options.args;
  const task = runnable.service.run(
    {
      components: group.components,
      config: runnable.config,
      args,
    },
    {
      workspaceRoot: options.workspaceRoot,
      envName: group.envName,
      cwd: options.workspaceRoot,
    }
  );
  options.onTask?.(task, eventContext);
  const unsubscribe = task.listen((type, payload) => options.onEvent?.(type, payload, eventContext));
  const abort = () => task.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const result = await task.result;
    return {
      envName: group.envName,
      serviceName: runnable.service.name,
      result,
    };
  } finally {
    options.signal?.removeEventListener("abort", abort);
    unsubscribe();
  }
}

export async function runRunnableGroups(
  runnableGroups: RunnableGroup[],
  options: RunRunnableGroupOptions
): Promise<ServiceRunResult[]> {
  if (options.execution === "parallel") {
    return Promise.all(runnableGroups.map((runnableGroup) => runRunnableGroup(runnableGroup, options)));
  }

  const results: ServiceRunResult[] = [];
  for (const runnableGroup of runnableGroups) {
    results.push(await runRunnableGroup(runnableGroup, options));
  }
  return results;
}

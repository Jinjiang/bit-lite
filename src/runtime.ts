import { BitLiteError } from "./errors.js";
import { loadServicesForEnv } from "./services.js";
import type { ServiceEventListener, ServiceResult, ServiceRunResult, ServiceTask, WorkspaceRuntime } from "./types.js";

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

  const runGroup = async ({ group, runnable }: RunnableGroup): Promise<ServiceRunResult> => {
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
        workspaceRoot: workspace.workspaceRoot,
        envName: group.envName,
        cwd: workspace.workspaceRoot,
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
  };

  if (options.execution === "parallel") {
    return Promise.all(runnableGroups.map(runGroup));
  }

  const results: ServiceRunResult[] = [];
  for (const runnableGroup of runnableGroups) {
    results.push(await runGroup(runnableGroup));
  }
  return results;
}

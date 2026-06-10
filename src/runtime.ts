import { BitLiteError } from "./errors.js";
import { loadServicesForEnv } from "./services.js";
import type { ServiceEvent, ServiceHost, ServiceOutputMode, ServiceResult, WorkspaceRuntime } from "./types.js";

export type ServiceRunResult = {
  envName: string;
  serviceName: string;
  result: ServiceResult;
};

export type ServiceRunEventContext = {
  envName: string;
  serviceName: string;
  serviceRef: string;
};

export type RunServiceOptions = {
  signal?: AbortSignal;
  outputMode?: ServiceOutputMode;
  onEvent?: (event: ServiceEvent, context: ServiceRunEventContext) => void;
};

type RunnableGroup = {
  group: WorkspaceRuntime["groups"][number];
  runnable: Awaited<ReturnType<typeof loadServicesForEnv>>[number];
};

export function createServiceHost(
  options: {
    signal?: AbortSignal;
    outputMode?: ServiceOutputMode;
    onEvent?: (event: ServiceEvent) => void;
  } = {}
): ServiceHost {
  const controller = options.signal ? undefined : new AbortController();
  return {
    signal: options.signal ?? controller!.signal,
    outputMode: options.outputMode ?? "inherit",
    emit(event) {
      options.onEvent?.(event);
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

  const results: ServiceRunResult[] = [];
  for (const { group, runnable } of runnableGroups) {
    const eventContext = {
      envName: group.envName,
      serviceName: runnable.service.name,
      serviceRef: runnable.serviceRef,
    };
    const result = await runnable.service.run({
      workspaceRoot: workspace.workspaceRoot,
      envName: group.envName,
      components: group.components,
      serviceConfig: runnable.config,
      host: createServiceHost({
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.outputMode ? { outputMode: options.outputMode } : {}),
        onEvent: (event) => options.onEvent?.(event, eventContext),
      }),
    });
    results.push({
      envName: group.envName,
      serviceName: runnable.service.name,
      result,
    });
  }
  return results;
}

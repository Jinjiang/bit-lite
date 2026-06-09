import { BitLiteError } from "./errors.js";
import { loadServicesForEnv } from "./services.js";
import type { ServiceOutputMode, ServiceReporter, ServiceResult, ServiceRunMode, WorkspaceRuntime } from "./types.js";

export type ServiceRunResult = {
  envName: string;
  serviceName: string;
  result: ServiceResult;
};

export type RunServiceOptions = {
  mode?: ServiceRunMode;
  output?: ServiceOutputMode;
  signal?: AbortSignal;
  createReporter?: (envName: string, serviceName: string) => ServiceReporter;
};

type RunnableGroup = {
  group: WorkspaceRuntime["groups"][number];
  runnable: Awaited<ReturnType<typeof loadServicesForEnv>>[number];
};

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

  const mode = options.mode ?? "run";
  const output = options.output ?? "inherit";
  const signal = options.signal ?? new AbortController().signal;
  const runGroup = async ({ group, runnable }: RunnableGroup): Promise<ServiceRunResult> => {
    const reporter = options.createReporter?.(group.envName, runnable.service.name) ?? noopReporter;
    const result = await runnable.service.run({
      workspaceRoot: workspace.workspaceRoot,
      envName: group.envName,
      components: group.components,
      serviceConfig: runnable.config,
      envServices: group.env.services,
      mode,
      output,
      signal,
      reporter,
    });
    return {
      envName: group.envName,
      serviceName: runnable.service.name,
      result,
    };
  };

  if (mode === "watch") {
    return Promise.all(runnableGroups.map(runGroup));
  }

  const results: ServiceRunResult[] = [];
  for (const runnableGroup of runnableGroups) {
    results.push(await runGroup(runnableGroup));
  }
  return results;
}

const noopReporter: ServiceReporter = {
  output() {},
};

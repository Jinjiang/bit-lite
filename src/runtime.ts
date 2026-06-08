import { BitLiteError } from "./errors.js";
import { loadServicesForEnv } from "./services.js";
import type { ServiceResult, WorkspaceRuntime } from "./types.js";

export type ServiceRunResult = {
  envName: string;
  serviceName: string;
  result: ServiceResult;
};

export async function runService(workspace: WorkspaceRuntime, serviceName: string): Promise<ServiceRunResult[]> {
  const runnableGroups = [];

  for (const group of workspace.groups) {
    const services = await loadServicesForEnv(workspace.workspaceRoot, group.env.services);
    const runnable = services.find(({ serviceRef, service }) => serviceRef === serviceName || service.name === serviceName);
    if (!runnable) continue;
    runnableGroups.push({ group, runnable });
  }

  if (runnableGroups.length === 0) {
    throw new BitLiteError(`service "${serviceName}" is not configured for any discovered env`);
  }

  const workspaceRunnable = runnableGroups.find(({ runnable }) => runnable.service.runWorkspace);
  if (workspaceRunnable?.runnable.service.runWorkspace) {
    const result = await workspaceRunnable.runnable.service.runWorkspace({
      workspaceRoot: workspace.workspaceRoot,
      groups: runnableGroups.map(({ group }) => group),
      serviceConfigs: Object.fromEntries(runnableGroups.map(({ group, runnable }) => [group.envName, runnable.config])),
    });
    return [
      {
        envName: "workspace",
        serviceName: workspaceRunnable.runnable.service.name,
        result,
      },
    ];
  }

  const results: ServiceRunResult[] = [];

  for (const { group, runnable } of runnableGroups) {
    const result = await runnable.service.run({
      workspaceRoot: workspace.workspaceRoot,
      envName: group.envName,
      components: group.components,
      serviceConfig: runnable.config,
    });
    results.push({
      envName: group.envName,
      serviceName: runnable.service.name,
      result,
    });
  }
  return results;
}

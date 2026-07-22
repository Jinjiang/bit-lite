import { readWorkspace, resolveWorkspace } from "bit-lite-context";
import { linkComponentPackages } from "../commands/link.js";
import { compileComponentPackages } from "../commands/compile.js";

export async function prepareWorkspaceForEnvLoading(workspaceRoot: string) {
  const workspace = await readWorkspace(workspaceRoot);
  await linkComponentPackages(workspace);
  const requiredLocalEnvPackages = new Set(
    workspace.components
      .map((component) => component.internalEnvPackageName)
      .filter((packageName): packageName is string => packageName !== undefined)
  );
  const envComponentIds = workspace.components
    .filter((component) => requiredLocalEnvPackages.has(component.packageName))
    .map((component) => component.id);
  await compileComponentPackages(workspace, envComponentIds);
  const context = await resolveWorkspace(workspace);
  return { workspace, context };
}

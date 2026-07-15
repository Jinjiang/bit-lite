import { loadComponentPackageRegistry, loadWorkspace } from "bit-lite-context";
import { linkComponentPackages } from "./commands/link.js";
import { materializeLocalEnvComponents } from "./env-component-compiler.js";

export async function prepareWorkspaceForEnvLoading(workspaceRoot: string) {
  const registry = await loadComponentPackageRegistry(workspaceRoot);
  await linkComponentPackages(registry);
  await materializeLocalEnvComponents(registry);
  const workspace = await loadWorkspace(workspaceRoot, { registry });
  return { registry, workspace };
}

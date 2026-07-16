import { readWorkspace, resolveWorkspace } from "bit-lite-context";
import { linkComponentPackages } from "../commands/link.js";
import { materializeLocalEnvComponents } from "./env-component-compiler.js";

export async function prepareWorkspaceForEnvLoading(workspaceRoot: string) {
  const workspace = await readWorkspace(workspaceRoot);
  await linkComponentPackages(workspace);
  await materializeLocalEnvComponents(workspace);
  const context = await resolveWorkspace(workspace);
  return { workspace, context };
}

import {
  groupWorkspaceComponentsByEnv,
  selectWorkspaceComponents,
} from "bit-lite-context";
import type {
  ParsedCliArgs,
  WorkspaceComponent,
  WorkspaceContext,
  WorkspaceEnvGroup,
} from "bit-lite-context";
import { prepareWorkspaceForEnvLoading } from "./prepare-workspace.js";

export type ResolvedCommandSelection = {
  parsed: ParsedCliArgs;
  context: WorkspaceContext;
  components: readonly WorkspaceComponent[];
  groups: readonly WorkspaceEnvGroup[];
};

type PrepareWorkspaceForEnvLoading = typeof prepareWorkspaceForEnvLoading;

export async function prepareResolvedCommandSelection(
  parsed: ParsedCliArgs,
  prepareWorkspace: PrepareWorkspaceForEnvLoading = prepareWorkspaceForEnvLoading
): Promise<ResolvedCommandSelection> {
  const { context } = await prepareWorkspace(parsed.workspaceRoot);
  const components = selectWorkspaceComponents(context.workspace, parsed.componentFilters);
  const groups = groupWorkspaceComponentsByEnv(context, components);

  return {
    parsed,
    context,
    components,
    groups,
  };
}

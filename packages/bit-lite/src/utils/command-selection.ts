import {
  groupWorkspaceComponentsByEnv,
  selectWorkspaceComponents,
} from "bit-lite-context";
import type {
  ParsedCliArgs,
  Workspace,
  WorkspaceComponent,
  WorkspaceContext,
  WorkspaceEnvGroup,
} from "bit-lite-context";
import { BitLiteError } from "./errors.js";
import { prepareWorkspaceForEnvLoading } from "./prepare-workspace.js";

/**
 * Resolves a selection that must name exactly one component, for commands whose
 * output describes a single component in detail. An ambiguous selection names
 * what it matched, so the user can narrow it without guessing.
 */
export function selectSingleWorkspaceComponent(
  workspace: Workspace,
  filters: readonly string[],
  commandName: string
): WorkspaceComponent {
  const components = selectWorkspaceComponents(workspace, filters);
  if (components.length === 0) {
    throw new BitLiteError(`no registered components to ${commandName}`);
  }
  if (components.length > 1) {
    const ids = components.map((component) => component.id).join(", ");
    throw new BitLiteError(
      `${commandName} reports one component, but the selection matched ${components.length}: ` +
        `${ids}. Narrow the selection with --filter.`
    );
  }
  return components[0]!;
}

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

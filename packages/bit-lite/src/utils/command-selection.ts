import { selectWorkspaceComponents } from "bit-lite-context";
import { groupWorkspaceComponentsByEnv } from "bit-lite-env-resolution";
import type { Workspace, WorkspaceComponent } from "bit-lite-context";
import type { ParsedCliArgs } from "../cli-args-types.js";
import type { WorkspaceContext, WorkspaceEnvGroup } from "bit-lite-env-resolution";
import { BitLiteError } from "bit-lite-utils";
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

/**
 * An undeclared option takes the bare word after it, which is right for a
 * vendor option and its value and wrong when that word was a component. The
 * parser cannot tell those apart — it would have to know the vendor's options —
 * but here the registered component IDs are known, so an exact match is a
 * strong enough signal to stop and ask rather than run with nothing selected.
 */
export function assertNoSwallowedComponents(parsed: ParsedCliArgs, workspace: Workspace) {
  if (parsed.consumedBareWords.length === 0) return;
  const registered = new Set(workspace.components.map((component) => component.id));
  for (const { option, value } of parsed.consumedBareWords) {
    if (!registered.has(value)) continue;
    throw new BitLiteError(
      `${option} consumed "${value}", which is a registered component. ` +
        `Write ${option}=<value> if that is the option's value, ` +
        `or move ${value} before ${option} if it is a component to select.`
    );
  }
}

type PrepareWorkspaceForEnvLoading = typeof prepareWorkspaceForEnvLoading;

export async function prepareResolvedCommandSelection(
  parsed: ParsedCliArgs,
  prepareWorkspace: PrepareWorkspaceForEnvLoading = prepareWorkspaceForEnvLoading
): Promise<ResolvedCommandSelection> {
  const { context } = await prepareWorkspace(parsed.workspaceRoot);
  assertNoSwallowedComponents(parsed, context.workspace);
  const components = selectWorkspaceComponents(context.workspace, parsed.componentFilters);
  const groups = groupWorkspaceComponentsByEnv(context, components);

  return {
    parsed,
    context,
    components,
    groups,
  };
}

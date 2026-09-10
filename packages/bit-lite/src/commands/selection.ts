import { readWorkspace, selectWorkspaceComponents } from "bit-lite-context";
import { groupWorkspaceComponentsByEnv, resolveWorkspace } from "bit-lite-env-resolution";
import type { Workspace, WorkspaceComponent } from "bit-lite-context";
import type { WorkspaceContext, WorkspaceEnvGroup } from "bit-lite-env-resolution";
import { BitLiteError } from "bit-lite-utils";
import type { ParsedCliArgs } from "../cli/arg-types.js";
import { assertNoSwallowedComponents } from "../cli/args.js";
import { compileComponentPackages } from "./compile.js";
import { linkComponentPackages } from "./link.js";

/**
 * What: how a command gets from a parsed command line to a selection it can
 * execute against.
 *
 * Why it sits among the commands rather than under them: reaching the resolved
 * phase means linking the workspace's component packages and compiling its
 * local envs, and both of those are capabilities the `link` and `compile`
 * commands expose. This composes two commands; it is not a layer they rest on.
 */

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

/**
 * Brings a workspace to the state env loading requires: every component package
 * linked, and every locally authored env compiled to the flattened JSON its
 * resolution reads.
 */
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

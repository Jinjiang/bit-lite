import { BitLiteError } from "bit-lite-context";
import type { Workspace, WorkspaceComponent } from "bit-lite-context";
import { getSelectedEnvKey } from "./env-identity.js";
import { loadWorkspaceEnvContexts } from "./env-loader.js";
import type { WorkspaceContext, WorkspaceEnvGroup } from "./types.js";

/**
 * What: the resolved phase of workspace preparation.
 *
 * Why it is a separate package: reading the base workspace needs nothing
 * installed, while resolving an env requires installation, linking, and env
 * materialization to have happened first. `workspace-context-model` requires
 * that separation, and a package boundary is what enforces it — a command that
 * must stay independent of installed packages cannot reach this code, because
 * it does not depend on this package.
 */

/** Resolve installed env packages while retaining references to canonical workspace components. */
export async function resolveWorkspace(workspace: Workspace): Promise<WorkspaceContext> {
  const envByComponent = await loadWorkspaceEnvContexts(workspace);
  return {
    workspace,
    components: workspace.components.map((component) => {
      const env = envByComponent.get(component.id);
      if (!env) throw new BitLiteError(`env for component "${component.id}" was not loaded`);
      return { component, env };
    }),
  };
}

export function groupWorkspaceComponentsByEnv(
  context: WorkspaceContext,
  selectedComponents: readonly WorkspaceComponent[]
): WorkspaceEnvGroup[] {
  const canonicalById = new Map(context.workspace.components.map((component) => [component.id, component]));
  const selectedIds = new Set<string>();
  for (const component of selectedComponents) {
    const canonical = canonicalById.get(component.id);
    if (canonical !== component) {
      throw new BitLiteError(`selected component "${component.id}" is not the canonical workspace component`);
    }
    if (selectedIds.has(component.id)) throw new BitLiteError("selected components must not contain duplicate ids");
    selectedIds.add(component.id);
  }

  const groups = new Map<string, WorkspaceEnvGroup>();
  for (const componentContext of context.components) {
    if (!selectedIds.has(componentContext.component.id)) continue;
    const key = getSelectedEnvKey(componentContext.env.env);
    const existing = groups.get(key);
    if (existing) {
      (existing.components as WorkspaceComponent[]).push(componentContext.component);
    } else {
      groups.set(key, { env: componentContext.env, components: [componentContext.component] });
    }
  }
  return [...groups.values()].sort((left, right) =>
    getSelectedEnvKey(left.env.env).localeCompare(getSelectedEnvKey(right.env.env))
  );
}

export function getWorkspaceEnvs(context: WorkspaceContext) {
  const envs = new Map<string, WorkspaceContext["components"][number]["env"]>();
  for (const component of context.components) envs.set(getSelectedEnvKey(component.env.env), component.env);
  return [...envs.values()].sort((left, right) =>
    getSelectedEnvKey(left.env).localeCompare(getSelectedEnvKey(right.env))
  );
}

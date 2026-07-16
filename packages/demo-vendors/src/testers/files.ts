import { findComponentFileTargets, findComponentFiles } from "bit-lite-context";
import type { ComponentFileTarget, WorkspaceComponent } from "bit-lite-context";

export const TEST_FILE_PATTERNS = ["**/*.test.*", "**/*.spec.*"] as const;

export type ComponentTestTarget = ComponentFileTarget;

export function findComponentTestFiles(component: WorkspaceComponent) {
  return findComponentFiles(component, TEST_FILE_PATTERNS);
}

export function findComponentTestTargets(components: readonly WorkspaceComponent[]) {
  return findComponentFileTargets(components, TEST_FILE_PATTERNS);
}

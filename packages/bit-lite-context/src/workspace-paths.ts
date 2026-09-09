import path from "node:path";

/**
 * What: the one place that knows where Bit Lite puts the files it generates.
 *
 * Why: installing, linking, env resolution, preview preparation, and source
 * browsing all address the same two directories. Each of them spelling
 * `.bit-lite/deps/components/...` for itself is how a path changes in one
 * caller and silently stops matching in another — and one of those callers is
 * the walk that decides which directories a snap must never capture.
 */

/** Disposable cache and generated state. Safe to delete; commands regenerate it. */
export const generatedStateDirectoryName = ".bit-lite";

export function getGeneratedStateDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, generatedStateDirectoryName);
}

/** Root of the generated pnpm workspace that owns every component's externals. */
export function getDependencyInstallRoot(workspaceRoot: string): string {
  return path.join(getGeneratedStateDirectory(workspaceRoot), "deps");
}

/** One component's isolated dependency project inside that generated workspace. */
export function getComponentDependencyDirectory(
  workspaceRoot: string,
  packageName: string
): string {
  return path.join(getDependencyInstallRoot(workspaceRoot), "components", ...packageName.split("/"));
}

/** The linked package a component is consumed as by the rest of the workspace. */
export function getLinkedPackageDirectory(workspaceRoot: string, packageName: string): string {
  return path.join(workspaceRoot, "node_modules", ...packageName.split("/"));
}

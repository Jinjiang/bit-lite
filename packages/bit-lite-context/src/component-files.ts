import path from "node:path";
import { collectFiles, toPosixPath } from "bit-lite-utils/node";
import type { WorkspaceComponent } from "./types/index.js";
import { matchPattern } from "./utils/patterns.js";

const ignoredDirs = new Set([".git", "dist", "node_modules"]);

export type ComponentFileTarget = {
  component: Pick<WorkspaceComponent, "id" | "rootDir">;
  files: string[];
};

export async function findComponentFiles(
  component: Pick<WorkspaceComponent, "id" | "rootDir">,
  patterns: readonly string[]
) {
  if (patterns.length === 0) return [];

  const files = await collectFiles(component.rootDir, {
    ignoredDirectories: ignoredDirs,
    missingDirectory: "ignore",
    traversal: "parallel",
  });

  return files
    .filter((file) => {
      const relativePath = toPosixPath(path.relative(component.rootDir, file));
      return patterns.some((pattern) => matchPattern(relativePath, pattern));
    })
    .sort();
}

export async function findComponentFileTargets(
  components: readonly Pick<WorkspaceComponent, "id" | "rootDir">[],
  patterns: readonly string[]
) {
  const targets: ComponentFileTarget[] = [];
  for (const component of components) {
    targets.push({
      component,
      files: await findComponentFiles(component, patterns),
    });
  }
  return targets;
}

import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceComponent } from "./types/index.js";
import { toPosixPath } from "./utils/path-utils.js";
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

  const files: string[] = [];
  await collectFiles(component.rootDir, files);

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

async function collectFiles(dir: string, files: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isFile()) {
        files.push(absolutePath);
        return;
      }

      if (!entry.isDirectory() || ignoredDirs.has(entry.name)) return;
      const stat = await lstat(absolutePath);
      if (!stat.isSymbolicLink()) await collectFiles(absolutePath, files);
    })
  );
}

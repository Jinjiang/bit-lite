import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createServiceTask } from "../../runtime.js";
import { serviceResult } from "../../utils/service-result.js";
import { normalizeRelativePath, toPosixPath } from "../../utils/path-utils.js";
import type { ComponentRef } from "../../types/index.js";
import type { SourceComponent, SourceResult, SourceService, SourceTreeDirectory, SourceTreeFile, SourceTreeNode } from "../../types/services/source.js";

const IGNORED_DIRS = new Set([".git", "node_modules"]);

export const sourceService: SourceService = {
  name: "source",
  run(input, context) {
    return createServiceTask(async () => {
      const envName = context?.envName;
      const components = await Promise.all(
        input.components.map(async (component): Promise<SourceComponent> => ({
          ...component,
          ...(envName ? { envName } : {}),
          tree: await buildSourceTree(component),
        }))
      );
      const text = `source indexed ${components.length} ${components.length === 1 ? "component" : "components"} for ${envName ?? "unknown"}`;
      return {
        ...serviceResult({
          ok: true,
          toJSON: (): SourceResult["toJSON"] extends () => infer Json ? Json : never => ({
            envName,
            components,
          }),
          toString: () => text,
        }),
        components,
      };
    });
  },
};

export async function readComponentSourceFile(component: SourceComponent, filePath: string) {
  const resolved = resolveComponentSourcePath(component.rootDir, filePath);
  return readFile(resolved, "utf8");
}

function resolveComponentSourcePath(componentRoot: string, filePath: string) {
  const relativePath = normalizeRelativePath(filePath);
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.startsWith("..")) {
    throw new Error(`invalid source file path "${filePath}"`);
  }
  const resolved = path.resolve(componentRoot, relativePath);
  const root = path.resolve(componentRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`source file path escapes component root: "${filePath}"`);
  }
  return resolved;
}

async function buildSourceTree(component: ComponentRef): Promise<SourceTreeDirectory> {
  const name = path.basename(component.rootDir);
  return readDirectory(component.rootDir, "", name);
}

async function readDirectory(absoluteDir: string, relativeDir: string, name: string): Promise<SourceTreeDirectory> {
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const children = await Promise.all(
    entries
      .filter((entry) => !shouldIgnoreEntry(entry.name, entry.isDirectory()))
      .map(async (entry): Promise<SourceTreeNode | undefined> => {
        const absolutePath = path.join(absoluteDir, entry.name);
        const relativePath = toPosixPath(path.join(relativeDir, entry.name));
        if (entry.isSymbolicLink()) return undefined;
        if (entry.isDirectory()) {
          return readDirectory(absolutePath, relativePath, entry.name);
        }
        if (!entry.isFile()) return undefined;
        const stat = await lstat(absolutePath);
        return {
          type: "file",
          name: entry.name,
          path: relativePath,
          size: stat.size,
        } satisfies SourceTreeFile;
      })
  );

  return {
    type: "directory",
    name,
    path: toPosixPath(relativeDir),
    children: children.filter((child): child is SourceTreeNode => Boolean(child)).sort(compareTreeNodes),
  };
}

function shouldIgnoreEntry(name: string, directory: boolean) {
  return directory && IGNORED_DIRS.has(name);
}

function compareTreeNodes(left: SourceTreeNode, right: SourceTreeNode) {
  if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
  return left.name.localeCompare(right.name);
}

export default sourceService;

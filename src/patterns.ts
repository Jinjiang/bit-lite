import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { normalizeRelativePath, toPosixPath } from "./path-utils.js";

const IGNORED_DIRS = new Set([".git", "dist", "node_modules"]);
const COMPONENT_MARKERS = new Set([
  "component.json",
  "index.js",
  "index.jsx",
  "index.ts",
  "index.tsx",
  "index.vue",
  "package.json",
]);

export async function discoverComponentDirs(workspaceRoot: string, patterns: string[] = []) {
  const candidates = new Set<string>();
  const defaultComponentsRoot = path.join(workspaceRoot, "components");
  await collectMarkedDirs(defaultComponentsRoot, candidates);

  for (const pattern of patterns) {
    const base = getPatternBase(pattern);
    const absoluteBase = path.resolve(workspaceRoot, base);
    await collectMarkedDirs(absoluteBase, candidates);
  }

  return Array.from(candidates).sort();
}

export function matchPattern(relativePath: string, pattern: string) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const normalizedPattern = normalizeRelativePath(pattern);
  return globToRegExp(normalizedPattern).test(normalizedPath);
}

export function getPatternBase(pattern: string) {
  const normalized = normalizeRelativePath(pattern);
  const parts = normalized.split("/");
  const globIndex = parts.findIndex((part) => part.includes("*"));
  if (globIndex === -1) return normalized;
  const base = parts.slice(0, globIndex).join("/");
  return base || ".";
}

function globToRegExp(pattern: string) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (!char) continue;
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      const after = pattern[index + 2];
      if (after === "/") {
        source += "(?:.*\\/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegExp(char);
    }
  }
  source += "$";
  return new RegExp(source);
}

function escapeRegExp(char: string) {
  return char.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

async function collectMarkedDirs(dir: string, candidates: Set<string>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  if (entries.some((entry) => entry.isFile() && COMPONENT_MARKERS.has(entry.name))) {
    candidates.add(dir);
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !IGNORED_DIRS.has(entry.name))
      .map(async (entry) => {
        const child = path.join(dir, entry.name);
        const stat = await lstat(child);
        if (!stat.isSymbolicLink()) await collectMarkedDirs(child, candidates);
      })
  );
}

export function componentIdFromDir(workspaceRoot: string, componentDir: string) {
  return toPosixPath(path.relative(workspaceRoot, componentDir));
}

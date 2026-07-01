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

/**
 * What: walks the default `components/` folder plus the non-glob base of each
 * configured pattern and returns directories that look like components.
 *
 * Where: use it during workspace loading to turn config patterns into concrete
 * component directories. It intentionally ignores `.git`, `dist`, and
 * `node_modules` so discovery stays focused on source code.
 *
 * Examples:
 * - With `components/ui/button/index.ts`, `discoverComponentDirs(root)` includes
 *   `<root>/components/ui/button`.
 * - With pattern `"packages/**"`, it starts scanning at `<root>/packages`.
 * - A directory containing `component.json` or `package.json` is treated as a
 *   component boundary.
 */
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

/**
 * What: checks whether a relative path matches a small glob pattern language
 * supporting `*` for one path segment and `**` for any nested path.
 *
 * Where: use it when assigning components to envs from config, or anywhere a
 * bit-lite config field needs lightweight path matching without pulling in a
 * full glob dependency.
 *
 * Examples:
 * - `matchPattern("components/ui/button", "components/ui/**")` returns `true`.
 * - `matchPattern("components/lib/math", "components/*" + "/math")` returns
 *   `true`.
 * - `matchPattern("components/ui/button", "components/lib/**")` returns
 *   `false`.
 */
export function matchPattern(relativePath: string, pattern: string) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const normalizedPattern = normalizeRelativePath(pattern);
  return globToRegExp(normalizedPattern).test(normalizedPath);
}

/**
 * What: extracts the fixed directory prefix before the first glob segment in a
 * pattern.
 *
 * Where: use it before filesystem scanning so discovery can start from the
 * narrowest safe directory instead of walking the whole workspace.
 *
 * Examples:
 * - `getPatternBase("components/ui/**")` returns `"components/ui"`.
 * - `getPatternBase("components/*" + "/button")` returns `"components"`.
 * - `getPatternBase("**")` returns `"."`.
 */
export function getPatternBase(pattern: string) {
  const normalized = normalizeRelativePath(pattern);
  const parts = normalized.split("/");
  const globIndex = parts.findIndex((part) => part.includes("*"));
  if (globIndex === -1) return normalized;
  const base = parts.slice(0, globIndex).join("/");
  return base || ".";
}

/**
 * What: converts bit-lite's small glob syntax into an anchored regular
 * expression.
 *
 * Where: keep this private to `matchPattern`; callers should pass human-facing
 * path patterns instead of depending on RegExp details.
 *
 * Examples:
 * - `globToRegExp("components/*")` matches `"components/ui"` but not
 *   `"components/ui/button"`.
 * - `globToRegExp("components/**")` matches `"components/ui/button"`.
 * - `globToRegExp("** /index.ts")` is not a supported spaced pattern; callers
 *   should pass `"**\/index.ts"` without spaces.
 */
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

/**
 * What: escapes a single literal pattern character so it can be embedded in a
 * regular expression without changing meaning.
 *
 * Where: use it inside glob conversion for all non-glob characters such as `.`,
 * `+`, `(`, or `[`.
 *
 * Examples:
 * - `escapeRegExp(".")` returns `"\\."`.
 * - `escapeRegExp("+")` returns `"\\+"`.
 * - `escapeRegExp("a")` returns `"a"`.
 */
function escapeRegExp(char: string) {
  return char.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

/**
 * What: recursively scans a directory and records child directories that
 * contain one of the component marker files.
 *
 * Where: use it as the filesystem worker behind `discoverComponentDirs`; it is
 * intentionally tolerant of missing directories so optional pattern bases do
 * not fail workspace loading.
 *
 * Examples:
 * - A directory with `index.ts` is added to `candidates`.
 * - A directory with only nested folders is scanned but not added itself.
 * - A missing path returns without throwing.
 */
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

/**
 * What: turns an absolute component directory into the stable workspace-relative
 * component id used by runtime data.
 *
 * Where: use it after discovery, before assigning envs or presenting component
 * identities to commands.
 *
 * Examples:
 * - `componentIdFromDir("/repo", "/repo/components/ui/button")` returns
 *   `"components/ui/button"`.
 * - On Windows paths, separators are still converted to `/`.
 * - If `componentDir` equals `workspaceRoot`, the result is an empty string,
 *   which callers should normally avoid by only passing discovered components.
 */
export function componentIdFromDir(workspaceRoot: string, componentDir: string) {
  return toPosixPath(path.relative(workspaceRoot, componentDir));
}

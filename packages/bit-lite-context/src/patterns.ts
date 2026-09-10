import { toPosixPath } from "bit-lite-utils/node";

/** Match component IDs for command-line filters using `*` and `**`. */
export function matchPattern(relativePath: string, pattern: string) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const normalizedPattern = normalizeRelativePath(pattern);
  return globToRegExp(normalizedPattern).test(normalizedPath);
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
      source += char.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

/**
 * What: prepares a relative path for matching by converting separators to `/`,
 * removing one leading `./`, and trimming one trailing slash.
 *
 * Where: use it before comparing config patterns, component ids, or user input
 * that may be written as `./components/**`, `components/ui/`, or with platform
 * separators.
 *
 * Examples:
 * - `normalizeRelativePath("./components/ui/")` returns `"components/ui"`.
 * - `normalizeRelativePath("components/ui")` returns `"components/ui"`.
 * - On Windows, `normalizeRelativePath(".\\components\\ui\\")` returns
 *   `"components/ui"`.
 */
function normalizeRelativePath(filePath: string) {
  const normalized = toPosixPath(filePath);
  return normalized.replace(/^\.\//, "").replace(/\/$/, "");
}

import { toPosixPath } from "bit-lite-utils/node";

export { toPosixPath };

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
export function normalizeRelativePath(filePath: string) {
  const normalized = toPosixPath(filePath);
  return normalized.replace(/^\.\//, "").replace(/\/$/, "");
}

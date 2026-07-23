import { toPosixPath } from "bit-lite-utils/node";

export { toPosixPath };

/**
 * What: converts a filesystem path to POSIX-style separators (`/`) without
 * resolving, normalizing, or touching the filesystem.
 *
 * Where: use it whenever bit-lite stores paths in config-facing values such as
 * component ids, glob inputs, snapshots, or JSON output. Keeping these paths
 * POSIX-style makes output stable across macOS, Linux, and Windows.
 *
 * Examples:
 * - `toPosixPath("components/ui/button")` returns `"components/ui/button"`.
 * - On Windows, `toPosixPath("components\\ui\\button")` returns
 *   `"components/ui/button"`.
 * - `toPosixPath(path.relative(root, componentDir))` gives a portable
 *   component id candidate.
 */
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

/**
 * What: tells whether a module reference should be resolved as a local path or
 * file URL instead of as a package name.
 *
 * Where: use it in loaders that accept both local modules and package refs.
 * This lets future service or vendor loading distinguish `"./service.ts"` from
 * `"some-package"`.
 *
 * Examples:
 * - `isLocalModuleRef("./service.js")` returns `true`.
 * - `isLocalModuleRef("/workspace/service.js")` returns `true`.
 * - `isLocalModuleRef("file:///tmp/service.js")` returns `true`.
 * - `isLocalModuleRef("eslint")` returns `false`.
 */
export function isLocalModuleRef(ref: string) {
  return ref.startsWith(".") || ref.startsWith("/") || ref.startsWith("file:");
}

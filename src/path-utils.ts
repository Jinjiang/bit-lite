import path from "node:path";

export function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

export function normalizeRelativePath(filePath: string) {
  const normalized = toPosixPath(filePath);
  return normalized.replace(/^\.\//, "").replace(/\/$/, "");
}

export function isLocalModuleRef(ref: string) {
  return ref.startsWith(".") || ref.startsWith("/") || ref.startsWith("file:");
}

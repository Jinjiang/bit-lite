import { readdir } from "node:fs/promises";
import path from "node:path";

export function fileHasKind(fileName: string, kind: string) {
  return fileName.split(".").includes(kind);
}

export async function findFilesByKind(dir: string, kind: string) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && fileHasKind(entry.name, kind))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

export async function findFirstFileByKind(dir: string, kind: string) {
  const files = await findFilesByKind(dir, kind);
  return files[0];
}

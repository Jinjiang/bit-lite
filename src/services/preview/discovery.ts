import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileHasKind, findFirstFileByKind } from "../../utils/file-matcher.js";
import type { ComponentRef } from "../../types/index.js";
import type { PreviewEntry } from "../../types/services/preview.js";

export async function discoverPreviewEntries(components: ComponentRef[], envName: string) {
  const entries: PreviewEntry[] = [];
  for (const component of components) {
    const previewFile = await findFirstFileByKind(component.rootDir, "preview");
    if (!previewFile) continue;
    const docsFile = await findFirstFileByKind(component.rootDir, "docs");
    const sourceFile = await findSourceFile(component.rootDir);
    entries.push({
      id: component.id,
      envName,
      rootDir: component.rootDir,
      previewFile,
      ...(docsFile ? { docsFile } : {}),
      ...(sourceFile ? { sourceFile } : {}),
    });
  }
  return entries.sort((left, right) => left.id.localeCompare(right.id));
}

async function findSourceFile(componentRoot: string) {
  let entries;
  try {
    entries = await readdir(componentRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const files = entries
    .filter((entry) => entry.isFile() && !["preview", "docs", "test", "spec"].some((kind) => fileHasKind(entry.name, kind)))
    .map((entry) => entry.name)
    .sort();
  const fileName = files.find((file) => file.split(".")[0] === "index") ?? files[0];
  return fileName ? path.join(componentRoot, fileName) : undefined;
}

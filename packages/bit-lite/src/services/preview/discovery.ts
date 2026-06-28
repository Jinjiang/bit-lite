import { findFirstFileByKind } from "../../utils/file-matcher.js";
import type { ComponentRef } from "../../types/index.js";
import type { PreviewEntry } from "../../types/services/preview.js";

export async function discoverPreviewEntries(components: ComponentRef[], envName: string) {
  const entries: PreviewEntry[] = [];
  for (const component of components) {
    const previewFile = await findFirstFileByKind(component.rootDir, "preview");
    if (!previewFile) continue;
    const docsFile = await findFirstFileByKind(component.rootDir, "docs");
    entries.push({
      id: component.id,
      envName,
      rootDir: component.rootDir,
      previewFile,
      ...(docsFile ? { docsFile } : {}),
    });
  }
  return entries.sort((left, right) => left.id.localeCompare(right.id));
}

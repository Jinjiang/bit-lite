import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceComponent } from "bit-lite-context";
import { discoverRuntimeExportNames } from "./demo-exports.js";
import { formatCompositionRoute, formatDocsRoute } from "./routes.js";

/**
 * What: reads a component's directory and reports what a preview can show for
 * it — one docs page and one composition per runtime export of each demo file.
 *
 * Why by convention rather than configuration: the file names are the whole
 * interface (`*.docs.md`, `*.docs.mdx`, `*.demo.*`), so adding a demo needs no
 * registration anywhere and a preview cannot fall out of step with the files
 * on disk.
 */

export type PreparedPreviewDocs = {
  title: string;
  filePath: string;
  route: string;
};

export type PreparedPreviewComposition = {
  id: string;
  exportName: string;
  name: string;
  filePath: string;
  route: string;
};

export type PreparedPreviewComponent = {
  component: { id: string };
  docs?: PreparedPreviewDocs;
  compositions: PreparedPreviewComposition[];
};

/** Sorted by component id, so a preview lists the same order every time. */
export async function discoverPreviewComponents(
  components: readonly WorkspaceComponent[]
): Promise<PreparedPreviewComponent[]> {
  const sorted = [...components].sort((left, right) => left.id.localeCompare(right.id));
  return Promise.all(sorted.map(discoverPreviewComponent));
}

async function discoverPreviewComponent(
  component: WorkspaceComponent
): Promise<PreparedPreviewComponent> {
  const entries = await readdir(component.rootDir, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const docsFileName = fileNames.find(
    (fileName) => fileName.endsWith(".docs.md") || fileName.endsWith(".docs.mdx")
  );
  const demoFiles = fileNames.flatMap((fileName) => {
    const fileId = readDemoFileId(fileName);
    return fileId === undefined ? [] : [{ fileId, fileName }];
  });

  const docs = docsFileName
    ? await createDocsEntry(component.id, path.join(component.rootDir, docsFileName))
    : undefined;
  const compositions = (
    await Promise.all(
      demoFiles.map(({ fileId, fileName }) =>
        createCompositionEntries(component.id, path.join(component.rootDir, fileName), fileId)
      )
    )
  ).flat();

  return {
    component: { id: component.id },
    ...(docs ? { docs } : {}),
    compositions,
  };
}

async function createDocsEntry(
  componentId: string,
  filePath: string
): Promise<PreparedPreviewDocs> {
  const source = await readFile(filePath, "utf8");
  return {
    title: readDocsTitle(source) ?? componentId,
    filePath,
    route: formatDocsRoute(componentId),
  };
}

async function createCompositionEntries(
  componentId: string,
  filePath: string,
  fileId: string
): Promise<PreparedPreviewComposition[]> {
  const source = await readFile(filePath, "utf8");
  return discoverRuntimeExportNames(source, filePath).map((exportName) => {
    const id = `${fileId}/${exportName}`;
    return {
      id,
      exportName,
      name: derivePreviewCompositionName(exportName),
      filePath,
      route: formatCompositionRoute(componentId, id),
    };
  });
}

/** `primaryButton` reads as "Primary button" in a list a person browses. */
export function derivePreviewCompositionName(exportName: string) {
  if (exportName === "default") return "Default";
  const words = exportName
    .replace(/[_$-]+/g, " ")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return words.length === 0 ? exportName : `${words[0]?.toUpperCase() ?? ""}${words.slice(1)}`;
}

/** Front matter first, then the document's own first heading. */
function readDocsTitle(source: string) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  const frontmatterTitle = frontmatter?.[1]?.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
  return frontmatterTitle ?? stripFrontmatter(source).match(/^#\s+(.+)$/m)?.[1];
}

function stripFrontmatter(source: string) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function readDemoFileId(fileName: string) {
  return /^(.*)\.demo\.[^.]+$/.exec(fileName)?.[1];
}

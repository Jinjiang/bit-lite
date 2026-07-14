import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatCompositionRoute, formatDocsRoute, formatOverviewRoute } from "./routes.js";
import type { PreviewPreparedRuntime } from "./types.js";

const previewHtmlTemplate = readFileSync(new URL("./assets/preview-entry.html", import.meta.url), "utf8");

export type PreviewComponentRef = {
  id: string;
  rootDir: string;
};

export type PreparedPreviewDocs = {
  title: string;
  filePath: string;
  route: string;
};

export type PreparedPreviewComposition = {
  id: string;
  filePath: string;
  route: string;
};

export type PreparedPreviewComponent = {
  component: { id: string };
  docs?: PreparedPreviewDocs;
  compositions: PreparedPreviewComposition[];
};

export type ResolvedPreviewServiceConfig = Record<string, unknown> & {
  configFile: string;
  mounter?: string;
  docsTemplate?: string;
};

export type PreparedPreviewEnv = {
  envName: string;
  components: PreparedPreviewComponent[];
  serviceConfig: Record<string, unknown>;
  runtime: PreviewPreparedRuntime;
  tempDir: string;
  cleanup(): Promise<void>;
};

export type PreviewServerRuntime = PreviewPreparedRuntime["server"];

type PreparePreviewEnvOptions = {
  envName: string;
  components: PreviewComponentRef[];
  serviceConfig: unknown;
  workspaceRoot: string;
  server: PreviewServerRuntime;
  browserModulePath?: string;
};

export async function preparePreviewEnv(options: PreparePreviewEnvOptions): Promise<PreparedPreviewEnv> {
  const components = await discoverPreviewComponents(options.components);
  const { serviceConfig, config } = await resolvePreviewServiceConfig(
    options.serviceConfig,
    options.workspaceRoot,
    options.envName
  );
  if (components.some((component) => component.compositions.length > 0) && !config.mounter) {
    throw new PreviewPreparationError(
      `preview env "${options.envName}" config.mounter is required because the selected components contain demos`
    );
  }

  const tempRoot = path.join(options.workspaceRoot, ".bit-lite");
  await mkdir(tempRoot, { recursive: true });
  const prefix = sanitizeFileName(options.envName);
  const tempDir = await mkdtemp(path.join(tempRoot, `preview-${prefix}-`));
  const entryFile = path.join(tempDir, "entry.mjs");
  const htmlFile = path.join(tempDir, "index.html");

  try {
    const browserModulePath = options.browserModulePath ?? (await resolvePreviewBrowserModule());
    await writeFile(
      entryFile,
      createPreviewEntrySource({ components, config, entryFile, browserModulePath }),
      "utf8"
    );
    await writeFile(htmlFile, createPreviewHtml(options.server.basePath), "utf8");
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  let cleaned = false;
  return {
    envName: options.envName,
    components,
    serviceConfig,
    runtime: {
      server: options.server,
      prepared: { entryFile, htmlFile },
    },
    tempDir,
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

export async function discoverPreviewComponents(components: PreviewComponentRef[]): Promise<PreparedPreviewComponent[]> {
  const sorted = [...components].sort((left, right) => left.id.localeCompare(right.id));
  return Promise.all(sorted.map(discoverPreviewComponent));
}

export async function resolvePreviewServiceConfig(
  serviceConfig: unknown,
  workspaceRoot: string,
  envName: string
): Promise<{ serviceConfig: Record<string, unknown>; config: ResolvedPreviewServiceConfig }> {
  if (!isRecord(serviceConfig)) throw new PreviewPreparationError(`preview env "${envName}" service config must be an object`);
  if (!isRecord(serviceConfig.config)) {
    throw new PreviewPreparationError(`preview env "${envName}" service config must define a config object`);
  }

  const config = serviceConfig.config;
  const configFile = readRequiredSpecifier(config.configFile, envName, "configFile");
  const mounter = readOptionalSpecifier(config.mounter, envName, "mounter");
  const docsTemplate = readOptionalSpecifier(config.docsTemplate, envName, "docsTemplate");
  const resolved: ResolvedPreviewServiceConfig = {
    ...config,
    configFile: await resolvePreviewModule(configFile, workspaceRoot, envName, "configFile"),
    ...(mounter ? { mounter: await resolvePreviewModule(mounter, workspaceRoot, envName, "mounter") } : {}),
    ...(docsTemplate
      ? { docsTemplate: await resolvePreviewModule(docsTemplate, workspaceRoot, envName, "docsTemplate") }
      : {}),
  } as ResolvedPreviewServiceConfig;

  return {
    config: resolved,
    serviceConfig: { ...serviceConfig, config: resolved },
  };
}

export function createPreviewEntrySource(options: {
  components: PreparedPreviewComponent[];
  config: ResolvedPreviewServiceConfig;
  entryFile: string;
  browserModulePath: string;
}) {
  const entryDir = path.dirname(options.entryFile);
  const imports = [
    `import { startPreview } from ${stringLiteral(relativeImport(entryDir, options.browserModulePath))};`,
    ...(options.config.mounter
      ? [`import previewMounter from ${stringLiteral(relativeImport(entryDir, options.config.mounter))};`]
      : []),
    ...(options.config.docsTemplate
      ? [`import PreviewDocsTemplate from ${stringLiteral(relativeImport(entryDir, options.config.docsTemplate))};`]
      : []),
  ];
  const componentSources = options.components.map((component) => createBrowserComponentSource(component, entryDir));
  const optionLines = [
    "  components,",
    ...(options.config.mounter ? ["  mounter: previewMounter,"] : []),
    ...(options.config.docsTemplate ? ["  docsTemplate: PreviewDocsTemplate,"] : []),
  ];

  return [
    ...imports,
    "",
    "const components = [",
    componentSources.join(",\n"),
    "];",
    "",
    "const previewController = startPreview({",
    ...optionLines,
    "});",
    "",
    "if (import.meta.hot) {",
    "  import.meta.hot.accept(() => previewController.refresh());",
    "  import.meta.hot.on(\"vite:beforeUpdate\", () => setTimeout(() => previewController.refresh(), 0));",
    "  import.meta.hot.dispose(() => previewController.stop());",
    "}",
    "if (typeof module !== \"undefined\" && module.hot) {",
    "  module.hot.accept();",
    "  module.hot.addStatusHandler?.((status) => {",
    "    if (status === \"idle\") void previewController.refresh();",
    "  });",
    "  module.hot.dispose(() => previewController.stop());",
    "}",
    "",
  ].join("\n");
}

export function createPreviewHtml(basePath: string) {
  const scriptPath = `${ensureTrailingSlash(basePath)}__bit-lite/preview.js`;
  return previewHtmlTemplate.replace("{{PREVIEW_SCRIPT_PATH}}", escapeHtml(scriptPath));
}

async function discoverPreviewComponent(component: PreviewComponentRef): Promise<PreparedPreviewComponent> {
  const entries = await readdir(component.rootDir, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const docsFileName = fileNames.find((fileName) => fileName.endsWith(".docs.md") || fileName.endsWith(".docs.mdx"));
  const demoFileNames = fileNames.filter((fileName) => readCompositionId(fileName) !== undefined);
  const docs = docsFileName
    ? await createDocsEntry(component.id, path.join(component.rootDir, docsFileName))
    : undefined;
  const compositions = await Promise.all(
    demoFileNames.map((fileName) => createCompositionEntry(component.id, path.join(component.rootDir, fileName), fileName))
  );
  return {
    component: { id: component.id },
    ...(docs ? { docs } : {}),
    compositions,
  };
}

async function createDocsEntry(componentId: string, filePath: string): Promise<PreparedPreviewDocs> {
  const source = await readFile(filePath, "utf8");
  return {
    title: readDocsTitle(source) ?? componentId,
    filePath,
    route: formatDocsRoute(componentId),
  };
}

async function createCompositionEntry(
  componentId: string,
  filePath: string,
  fileName: string
): Promise<PreparedPreviewComposition> {
  const id = readCompositionId(fileName);
  if (!id) throw new PreviewPreparationError(`invalid demo file name: ${fileName}`);
  return {
    id,
    filePath,
    route: formatCompositionRoute(componentId, id),
  };
}

function createBrowserComponentSource(component: PreparedPreviewComponent, entryDir: string) {
  const docsSource = component.docs
    ? [
        "    docs: {",
        `      title: ${stringLiteral(component.docs.title)},`,
        `      route: ${stringLiteral(component.docs.route)},`,
        `      load: () => import(${stringLiteral(relativeImport(entryDir, component.docs.filePath))}),`,
        "    },",
      ]
    : [];
  const compositionSources = component.compositions.map((composition) =>
    [
      "      {",
      `        id: ${stringLiteral(composition.id)},`,
      `        route: ${stringLiteral(composition.route)},`,
      `        load: () => import(${stringLiteral(relativeImport(entryDir, composition.filePath))}),`,
      "      },",
    ].join("\n")
  );
  return [
    "  {",
    `    component: { id: ${stringLiteral(component.component.id)} },`,
    ...docsSource,
    "    compositions: [",
    ...compositionSources,
    "    ],",
    "  }",
  ].join("\n");
}

async function resolvePreviewModule(specifier: string, workspaceRoot: string, envName: string, field: string) {
  const candidate = await tryResolvePreviewModule(specifier, workspaceRoot);
  if (candidate) return candidate;
  throw new PreviewPreparationError(`preview env "${envName}" config.${field} could not be resolved: ${specifier}`);
}

async function tryResolvePreviewModule(specifier: string, workspaceRoot: string) {
  if (isFileUrl(specifier)) {
    const filePath = fileURLToPath(specifier);
    return (await isFile(filePath)) ? filePath : undefined;
  }

  const workspaceRequire = createRequire(path.join(workspaceRoot, "package.json"));
  const commandRequire = createRequire(import.meta.url);
  if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
    const absolutePath = path.isAbsolute(specifier) ? specifier : path.resolve(workspaceRoot, specifier);
    if (await isFile(absolutePath)) return absolutePath;
  }

  for (const resolver of [workspaceRequire, commandRequire]) {
    try {
      return resolver.resolve(specifier);
    } catch {
      // Try the next resolution root.
    }
  }
  return undefined;
}

async function resolvePreviewBrowserModule() {
  const resolved = await tryResolvePreviewModule("bit-lite-preview/browser", process.cwd());
  if (resolved) return resolved;
  const monorepoSource = fileURLToPath(new URL("./browser/index.tsx", import.meta.url));
  if (await isFile(monorepoSource)) return monorepoSource;
  throw new PreviewPreparationError("bit-lite-preview/browser could not be resolved for generated preview entry");
}

async function isFile(filePath: string) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function readRequiredSpecifier(value: unknown, envName: string, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new PreviewPreparationError(`preview env "${envName}" config.${field} must be a non-empty string`);
  }
  return value;
}

function readOptionalSpecifier(value: unknown, envName: string, field: string) {
  if (value === undefined) return undefined;
  return readRequiredSpecifier(value, envName, field);
}

function relativeImport(fromDir: string, target: string) {
  const relative = toPosixPath(path.relative(fromDir, target));
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function stringLiteral(value: string) {
  return JSON.stringify(value);
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "env";
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function readDocsTitle(source: string) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  const frontmatterTitle = frontmatter?.[1]?.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
  return frontmatterTitle ?? stripFrontmatter(source).match(/^#\s+(.+)$/m)?.[1];
}

function stripFrontmatter(source: string) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function readCompositionId(fileName: string) {
  return /^(.*)\.demo\.[^.]+$/.exec(fileName)?.[1];
}

function isFileUrl(value: string) {
  try {
    return new URL(value).protocol === "file:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return character;
    }
  });
}

export class PreviewPreparationError extends Error {
  override name = "PreviewPreparationError";
}

export function createPreparedOverviewRoute(componentId: string) {
  return formatOverviewRoute(componentId);
}

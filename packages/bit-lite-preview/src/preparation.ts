import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { getSelectedEnvKey } from "bit-lite-context";
import { isFileUrl, isRecord, sanitizeFileName } from "bit-lite-utils";
import { isFile, toPosixPath } from "bit-lite-utils/node";
import type { SelectedEnvIdentity, WorkspaceComponent } from "bit-lite-context";
import { formatCompositionRoute, formatDocsRoute, formatOverviewRoute } from "./routes.js";
import type { PreviewPreparedRuntime } from "./types.js";

const previewHtmlTemplate = readFileSync(new URL("./assets/preview-entry.html", import.meta.url), "utf8");

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

export type ResolvedPreviewServiceConfig = Record<string, unknown> & {
  configFile: string;
  mounter?: string;
  docsTemplate?: string;
};

export type PreparedPreviewEnv = {
  env: SelectedEnvIdentity;
  components: PreparedPreviewComponent[];
  config: ResolvedPreviewServiceConfig;
  runtime: PreviewPreparedRuntime;
  tempDir: string;
  cleanup(): Promise<void>;
};

export type PreviewServerRuntime = PreviewPreparedRuntime["server"];

type PreparePreviewEnvOptions = {
  env: SelectedEnvIdentity;
  components: readonly WorkspaceComponent[];
  config: unknown;
  workspaceRoot: string;
  server: PreviewServerRuntime;
  browserModulePath?: string;
  resolveModule?: ((specifier: string, field: string) => Promise<string>) | undefined;
};

export async function preparePreviewEnv(options: PreparePreviewEnvOptions): Promise<PreparedPreviewEnv> {
  const components = await discoverPreviewComponents(options.components);
  const aliases = createPreviewPackageAliases(options.components);
  const config = await resolvePreviewServiceConfig(
    options.config,
    options.workspaceRoot,
    options.env.packageName,
    options.resolveModule
  );
  if (components.some((component) => component.compositions.length > 0) && !config.mounter) {
    throw new PreviewPreparationError(
      `preview env "${options.env.packageName}" config.mounter is required because the selected components contain demos`
    );
  }

  const tempRoot = path.join(options.workspaceRoot, ".bit-lite");
  await mkdir(tempRoot, { recursive: true });
  const prefix = sanitizeFileName(getSelectedEnvKey(options.env));
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
    await writeFile(htmlFile, createPreviewHtml(), "utf8");
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  let cleaned = false;
  return {
    env: options.env,
    components,
    config,
    runtime: {
      server: options.server,
      prepared: { entryFile, htmlFile },
      aliases,
    },
    tempDir,
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

function createPreviewPackageAliases(components: readonly WorkspaceComponent[]) {
  const seenPackageNames = new Set<string>();
  const aliases = [...components]
    .sort((left, right) => left.packageName.localeCompare(right.packageName) || left.id.localeCompare(right.id))
    .map((component) => {
      if (component.packageName.length === 0) {
        throw new PreviewPreparationError(`preview component "${component.id}" packageName must be a non-empty string`);
      }
      if (seenPackageNames.has(component.packageName)) {
        throw new PreviewPreparationError(`preview component packageName "${component.packageName}" is duplicated`);
      }
      seenPackageNames.add(component.packageName);
      return {
        packageName: component.packageName,
        sourceDir: path.resolve(component.rootDir),
      };
    });

  return aliases;
}

export async function discoverPreviewComponents(
  components: readonly WorkspaceComponent[]
): Promise<PreparedPreviewComponent[]> {
  const sorted = [...components].sort((left, right) => left.id.localeCompare(right.id));
  return Promise.all(sorted.map(discoverPreviewComponent));
}

export async function resolvePreviewServiceConfig(
  config: unknown,
  workspaceRoot: string,
  selectedEnvPackageName: string,
  resolveModule?: ((specifier: string, field: string) => Promise<string>) | undefined
): Promise<ResolvedPreviewServiceConfig> {
  if (!isRecord(config)) {
    throw new PreviewPreparationError(`preview env "${selectedEnvPackageName}" service config must be an object`);
  }
  const configFile = readRequiredSpecifier(config.configFile, selectedEnvPackageName, "configFile");
  const mounter = readOptionalSpecifier(config.mounter, selectedEnvPackageName, "mounter");
  const docsTemplate = readOptionalSpecifier(config.docsTemplate, selectedEnvPackageName, "docsTemplate");
  const resolve = resolveModule ?? ((specifier: string, field: string) =>
    resolvePreviewModule(specifier, workspaceRoot, selectedEnvPackageName, field));
  const resolved: ResolvedPreviewServiceConfig = {
    ...config,
    configFile: await resolve(configFile, "configFile"),
    ...(mounter ? { mounter: await resolve(mounter, "mounter") } : {}),
    ...(docsTemplate
      ? { docsTemplate: await resolve(docsTemplate, "docsTemplate") }
      : {}),
  } as ResolvedPreviewServiceConfig;

  return resolved;
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

export function createPreviewHtml() {
  return previewHtmlTemplate.replace("{{PREVIEW_SCRIPT_PATH}}", "./__bit-lite/preview.js");
}

async function discoverPreviewComponent(component: WorkspaceComponent): Promise<PreparedPreviewComponent> {
  const entries = await readdir(component.rootDir, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const docsFileName = fileNames.find((fileName) => fileName.endsWith(".docs.md") || fileName.endsWith(".docs.mdx"));
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

async function createDocsEntry(componentId: string, filePath: string): Promise<PreparedPreviewDocs> {
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
      `        exportName: ${stringLiteral(composition.exportName)},`,
      `        name: ${stringLiteral(composition.name)},`,
      `        route: ${stringLiteral(composition.route)},`,
      `        load: () => import(${stringLiteral(relativeImport(entryDir, composition.filePath))})`,
      `          .then((module) => module[${stringLiteral(composition.exportName)}]),`,
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

async function resolvePreviewModule(
  specifier: string,
  workspaceRoot: string,
  selectedEnvPackageName: string,
  field: string
) {
  const candidate = await tryResolvePreviewModule(specifier, workspaceRoot);
  if (candidate) return candidate;
  throw new PreviewPreparationError(
    `preview env "${selectedEnvPackageName}" config.${field} could not be resolved: ${specifier}`
  );
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

function readRequiredSpecifier(value: unknown, selectedEnvPackageName: string, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new PreviewPreparationError(
      `preview env "${selectedEnvPackageName}" config.${field} must be a non-empty string`
    );
  }
  return value;
}

function readOptionalSpecifier(value: unknown, selectedEnvPackageName: string, field: string) {
  if (value === undefined) return undefined;
  return readRequiredSpecifier(value, selectedEnvPackageName, field);
}

function relativeImport(fromDir: string, target: string) {
  const relative = toPosixPath(path.relative(fromDir, target));
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function stringLiteral(value: string) {
  return JSON.stringify(value);
}

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

function discoverRuntimeExportNames(source: string, filePath: string) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(filePath)
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }
  ).parseDiagnostics;
  if (parseDiagnostics && parseDiagnostics.length > 0) {
    const diagnostic = parseDiagnostics[0];
    const message = diagnostic ? ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n") : "unknown parse error";
    throw new PreviewPreparationError(`could not parse demo file ${filePath}: ${message}`);
  }

  const localTypes = collectLocalTypeOnlyNames(sourceFile);
  const localValues = collectLocalValueNames(sourceFile);
  const exportNames: string[] = [];
  const seen = new Set<string>();
  const add = (exportName: string) => {
    if (seen.has(exportName)) return;
    seen.add(exportName);
    exportNames.push(exportName);
  };

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      if (!statement.isExportEquals) add("default");
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      if (!statement.exportClause) {
        throw new PreviewPreparationError(
          `demo file ${filePath} uses unsupported unresolved export *; use explicit named exports instead`
        );
      }
      if (ts.isNamespaceExport(statement.exportClause)) {
        add(statement.exportClause.name.text);
        continue;
      }
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const localName = element.propertyName?.text ?? element.name.text;
        if (!statement.moduleSpecifier && localTypes.has(localName) && !localValues.has(localName)) continue;
        add(element.name.text);
      }
      continue;
    }

    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    if (isTypeOnlyDeclaration(statement) || hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) continue;
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      add("default");
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of readBindingNames(declaration.name)) add(name);
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name
    ) {
      add(statement.name.text);
    }
  }

  return exportNames;
}

export function derivePreviewCompositionName(exportName: string) {
  if (exportName === "default") return "Default";
  const words = exportName
    .replace(/[_$-]+/g, " ")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return words.length === 0 ? exportName : `${words[0]?.toUpperCase() ?? ""}${words.slice(1)}`;
}

function collectLocalTypeOnlyNames(sourceFile: ts.SourceFile) {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      names.add(statement.name.text);
      continue;
    }
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const { importClause } = statement;
    if (importClause.isTypeOnly) {
      if (importClause.name) names.add(importClause.name.text);
      if (importClause.namedBindings) {
        for (const name of readImportBindingNames(importClause.namedBindings)) names.add(name);
      }
      continue;
    }
    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        if (element.isTypeOnly) names.add(element.name.text);
      }
    }
  }
  return names;
}

function collectLocalValueNames(sourceFile: ts.SourceFile) {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of readBindingNames(declaration.name)) names.add(name);
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
      continue;
    }
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const { importClause } = statement;
    if (importClause.name) names.add(importClause.name.text);
    if (!importClause.namedBindings) continue;
    if (ts.isNamespaceImport(importClause.namedBindings)) {
      names.add(importClause.namedBindings.name.text);
    } else {
      for (const element of importClause.namedBindings.elements) {
        if (!element.isTypeOnly) names.add(element.name.text);
      }
    }
  }
  return names;
}

function readBindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : readBindingNames(element.name)));
}

function readImportBindingNames(bindings: ts.NamedImportBindings) {
  return ts.isNamespaceImport(bindings)
    ? [bindings.name.text]
    : bindings.elements.map((element) => element.name.text);
}

function isTypeOnlyDeclaration(statement: ts.Statement) {
  return ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind) {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true;
}

function readScriptKind(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".tsx": return ts.ScriptKind.TSX;
    case ".jsx": return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs": return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

export class PreviewPreparationError extends Error {
  override name = "PreviewPreparationError";
}

export function createPreparedOverviewRoute(componentId: string) {
  return formatOverviewRoute(componentId);
}

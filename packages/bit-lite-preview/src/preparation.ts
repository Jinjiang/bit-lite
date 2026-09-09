import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getGeneratedStateDirectory } from "bit-lite-context";
import { getSelectedEnvKey } from "bit-lite-env-resolution";
import { isFileUrl, isRecord, sanitizeFileName } from "bit-lite-utils";
import { isFile } from "bit-lite-utils/node";
import type { WorkspaceComponent } from "bit-lite-context";
import type { SelectedEnvIdentity } from "bit-lite-env-resolution";
import { discoverPreviewComponents } from "./component-discovery.js";
import type { PreparedPreviewComponent } from "./component-discovery.js";
import { createPreviewEntrySource, createPreviewHtml } from "./entry-source.js";
import { PreviewPreparationError } from "./errors.js";
import { formatOverviewRoute } from "./routes.js";
import type { PreviewPreparedRuntime } from "./types.js";

/**
 * What: turns one env's components and preview configuration into something a
 * dev server can bundle — a generated entry module, an HTML shell, and the
 * package aliases that point imports at component sources.
 *
 * Why a temporary directory: the entry is derived state, regenerated on every
 * run and owned by the command that made it. Writing it beside the components
 * would put a generated file into the tree a snap captures.
 */

export type ResolvedPreviewServiceConfig = Record<string, unknown> & {
  configFile: string;
  mounter?: string;
  docsTemplate?: string;
};

export type PreviewServerRuntime = PreviewPreparedRuntime["server"];

export type PreparedPreviewEnv = {
  env: SelectedEnvIdentity;
  components: PreparedPreviewComponent[];
  config: ResolvedPreviewServiceConfig;
  runtime: PreviewPreparedRuntime;
  tempDir: string;
  cleanup(): Promise<void>;
};

type PreparePreviewEnvOptions = {
  env: SelectedEnvIdentity;
  components: readonly WorkspaceComponent[];
  config: unknown;
  workspaceRoot: string;
  server: PreviewServerRuntime;
  browserModulePath?: string;
  resolveModule?: ((specifier: string, field: string) => Promise<string>) | undefined;
};

export async function preparePreviewEnv(
  options: PreparePreviewEnvOptions
): Promise<PreparedPreviewEnv> {
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

  const tempRoot = getGeneratedStateDirectory(options.workspaceRoot);
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
    runtime: { server: options.server, prepared: { entryFile, htmlFile }, aliases },
    tempDir,
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

/**
 * Maps each component's package name to its source directory, so a demo can
 * import the component the way anything else would — by package name — and
 * still get the working sources rather than the last compiled output.
 */
function createPreviewPackageAliases(components: readonly WorkspaceComponent[]) {
  const seenPackageNames = new Set<string>();
  return [...components]
    .sort(
      (left, right) =>
        left.packageName.localeCompare(right.packageName) || left.id.localeCompare(right.id)
    )
    .map((component) => {
      if (component.packageName.length === 0) {
        throw new PreviewPreparationError(
          `preview component "${component.id}" packageName must be a non-empty string`
        );
      }
      if (seenPackageNames.has(component.packageName)) {
        throw new PreviewPreparationError(
          `preview component packageName "${component.packageName}" is duplicated`
        );
      }
      seenPackageNames.add(component.packageName);
      return { packageName: component.packageName, sourceDir: path.resolve(component.rootDir) };
    });
}

/**
 * Resolves the module specifiers in a preview service configuration to files.
 * Unknown fields are carried through untouched: they belong to the vendor,
 * which is the only thing that knows what they mean.
 */
export async function resolvePreviewServiceConfig(
  config: unknown,
  workspaceRoot: string,
  selectedEnvPackageName: string,
  resolveModule?: ((specifier: string, field: string) => Promise<string>) | undefined
): Promise<ResolvedPreviewServiceConfig> {
  if (!isRecord(config)) {
    throw new PreviewPreparationError(
      `preview env "${selectedEnvPackageName}" service config must be an object`
    );
  }
  const configFile = readSpecifier(config.configFile, selectedEnvPackageName, "configFile");
  const mounter = readOptionalSpecifier(config.mounter, selectedEnvPackageName, "mounter");
  const docsTemplate = readOptionalSpecifier(
    config.docsTemplate,
    selectedEnvPackageName,
    "docsTemplate"
  );
  const resolve =
    resolveModule ??
    ((specifier: string, field: string) =>
      resolvePreviewModule(specifier, workspaceRoot, selectedEnvPackageName, field));

  return {
    ...config,
    configFile: await resolve(configFile, "configFile"),
    ...(mounter ? { mounter: await resolve(mounter, "mounter") } : {}),
    ...(docsTemplate ? { docsTemplate: await resolve(docsTemplate, "docsTemplate") } : {}),
  } as ResolvedPreviewServiceConfig;
}

export function createPreparedOverviewRoute(componentId: string) {
  return formatOverviewRoute(componentId);
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

/**
 * Tries the workspace first and this package second, because a config module
 * normally lives in the workspace and only the browser runtime ships here.
 */
async function tryResolvePreviewModule(specifier: string, workspaceRoot: string) {
  if (isFileUrl(specifier)) {
    const filePath = fileURLToPath(specifier);
    return (await isFile(filePath)) ? filePath : undefined;
  }

  if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
    const absolutePath = path.isAbsolute(specifier)
      ? specifier
      : path.resolve(workspaceRoot, specifier);
    if (await isFile(absolutePath)) return absolutePath;
  }

  for (const from of [path.join(workspaceRoot, "package.json"), import.meta.url]) {
    try {
      return createRequire(from).resolve(specifier);
    } catch {
      // Try the next resolution root.
    }
  }
  return undefined;
}

/**
 * The browser runtime the generated entry imports. Resolved as a package first;
 * the source fallback is what makes this repository's own demo work before the
 * package has been built.
 */
async function resolvePreviewBrowserModule() {
  const resolved = await tryResolvePreviewModule("bit-lite-preview/browser", process.cwd());
  if (resolved) return resolved;
  const monorepoSource = fileURLToPath(new URL("./browser/index.tsx", import.meta.url));
  if (await isFile(monorepoSource)) return monorepoSource;
  throw new PreviewPreparationError(
    "bit-lite-preview/browser could not be resolved for generated preview entry"
  );
}

function readSpecifier(value: unknown, selectedEnvPackageName: string, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new PreviewPreparationError(
      `preview env "${selectedEnvPackageName}" config.${field} must be a non-empty string`
    );
  }
  return value;
}

function readOptionalSpecifier(value: unknown, selectedEnvPackageName: string, field: string) {
  return value === undefined ? undefined : readSpecifier(value, selectedEnvPackageName, field);
}

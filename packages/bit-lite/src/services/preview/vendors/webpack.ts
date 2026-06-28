import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Configuration, RuleSetRule } from "webpack";
import { createServiceTask } from "../../../runtime.js";
import { readObjectConfig } from "../../../service-config.js";
import { registerPreviewVendorCloser } from "../runtime.js";
import { serviceResult } from "../../../utils/service-result.js";
import type { PreviewEntry, PreviewVendor } from "../../../types/services/preview.js";

const require = createRequire(import.meta.url);
const DEFAULT_HOST = "127.0.0.1";

export const webpackPreviewVendor: PreviewVendor = {
  name: "webpack",
  run(input, context) {
    return createServiceTask(async ({ emit }) => {
      const workspaceRoot = requireWorkspaceRoot(context);
      const config = readObjectConfig(input.config);
      const userConfig = await loadWebpackConfig(config, workspaceRoot);
      const appRoot = await generatePreviewApp(input.entries, input.base, workspaceRoot);
      const tsconfigPath = path.join(appRoot, "tsconfig.json");
      const styleLoaderPath = path.join(appRoot, "style-inject-loader.cjs");
      const webpackModule = await import("webpack");
      const devServerModule = await import("webpack-dev-server");
      const webpack = webpackModule.default;
      const WebpackDevServer = devServerModule.default;
      const host = readHost(userConfig.devServer?.host);
      emit("output", { stream: "stdout", chunk: `starting webpack preview on port ${input.port}\n` });
      const compiler = webpack({
        ...userConfig,
        mode: "development",
        context: appRoot,
        entry: path.join(appRoot, "src/main.ts"),
        output: {
          ...readObjectConfig(userConfig.output),
          path: path.join(appRoot, "dist"),
          filename: "main.js",
          publicPath: input.base,
        },
        devtool: userConfig.devtool ?? false,
        resolve: {
          ...readObjectConfig(userConfig.resolve),
          extensions: [".ts", ".tsx", ".js", ".jsx"],
          extensionAlias: {
            ...readObjectConfig(readObjectConfig(userConfig.resolve).extensionAlias),
            ".js": [".ts", ".tsx", ".js"],
          },
        },
        resolveLoader: {
          ...readObjectConfig(userConfig.resolveLoader),
          modules: mergeResolverModules(userConfig.resolveLoader, workspaceRoot),
        },
        module: {
          ...readObjectConfig(userConfig.module),
          rules: [
            ...readRules(userConfig.module?.rules),
            ...createCssFallbackRules(userConfig.module?.rules, styleLoaderPath),
            {
              resourceQuery: /raw/,
              type: "asset/source",
            },
            {
              test: /\.tsx?$/,
              resourceQuery: { not: [/raw/] },
              loader: require.resolve("ts-loader"),
              options: {
                transpileOnly: true,
                configFile: tsconfigPath,
                compilerOptions: {
                  target: "es2022",
                  module: "esnext",
                  moduleResolution: "bundler",
                  jsx: "react-jsx",
                  ignoreDeprecations: "6.0",
                },
              },
            },
            {
              test: /\.md$/,
              type: "asset/source",
            },
          ],
        },
        infrastructureLogging: {
          ...readObjectConfig(userConfig.infrastructureLogging),
          level: "none",
        },
        stats: userConfig.stats ?? "none",
      } as Configuration);
      compiler.hooks.compile.tap("bit-lite-preview", () => {
        emit("output", { stream: "stdout", chunk: "webpack compiling preview...\n" });
      });
      compiler.hooks.done.tap("bit-lite-preview", (stats) => {
        if (stats.hasErrors()) {
          emit("output", { stream: "stderr", chunk: `${stats.toString({ colors: false, errors: true, warnings: false })}\n` });
          return;
        }
        if (stats.hasWarnings()) {
          emit("output", { stream: "stderr", chunk: `${stats.toString({ colors: false, errors: false, warnings: true })}\n` });
        }
        emit("output", { stream: "stdout", chunk: "webpack preview compiled\n" });
      });
      compiler.hooks.failed.tap("bit-lite-preview", (error) => {
        emit("output", { stream: "stderr", chunk: `${error.message}\n` });
      });
      const server = new WebpackDevServer(
        {
          ...userConfig.devServer,
          host,
          port: input.port,
          allowedHosts: "all",
          static: {
            directory: appRoot,
            publicPath: input.base,
          },
          devMiddleware: {
            stats: false,
            publicPath: input.base,
          },
          client: {
            logging: "none",
          },
          historyApiFallback: {
            index: `${input.base}index.html`,
          },
        },
        compiler
      );

      await server.start();
      registerPreviewVendorCloser(() => server.stop());
      const url = `http://${host}:${input.port}${input.base}`;
      emit("output", { stream: "stdout", chunk: `webpack preview ready at ${url}\n` });
      emit("ready", { url, host, port: input.port, base: input.base });
      return {
        ...serviceResult({
          ok: true,
          toJSON: () => ({
            vendor: "webpack",
            envName: context?.envName,
            url,
            host,
            port: input.port,
            base: input.base,
            entries: input.entries,
          }),
          toString: () => `webpack preview ${context?.envName} running at ${url}`,
        }),
        ok: true,
        url,
        host,
        port: input.port,
        base: input.base,
      };
    });
  },
};

export default webpackPreviewVendor;

type WebpackUserConfig = Configuration & {
  devServer?: Record<string, unknown>;
  module?: Record<string, unknown> & { rules?: unknown };
};

async function loadWebpackConfig(config: Record<string, unknown>, workspaceRoot: string): Promise<WebpackUserConfig> {
  if (typeof config.configFile !== "string") return {};
  const configPath = path.resolve(workspaceRoot, config.configFile);
  const mod = (await import(pathToFileURL(configPath).href)) as { default?: unknown };
  const loaded = typeof mod.default === "function" ? await mod.default() : mod.default;
  return readObjectConfig(loaded) as WebpackUserConfig;
}

function readRules(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function mergeResolverModules(resolveLoader: unknown, workspaceRoot: string) {
  const configuredModules = readStringArray(readObjectConfig(resolveLoader).modules);
  return uniqueStrings([
    ...configuredModules,
    path.join(workspaceRoot, "node_modules"),
    packageNodeModulesRoot(),
    "node_modules",
  ]);
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueStrings(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function packageNodeModulesRoot() {
  return path.dirname(path.dirname(require.resolve("webpack/package.json")));
}

function readHost(value: unknown) {
  return typeof value === "string" && value !== "0.0.0.0" ? value : DEFAULT_HOST;
}

async function generatePreviewApp(entries: PreviewEntry[], base: string, workspaceRoot: string) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-webpack-preview-"));
  const srcRoot = path.join(appRoot, "src");
  await mkdir(srcRoot, { recursive: true });
  await writeFile(path.join(appRoot, "style-inject-loader.cjs"), STYLE_INJECT_LOADER, "utf8");
  await writeFile(path.join(appRoot, "tsconfig.json"), renderTsconfig(workspaceRoot), "utf8");
  await writeFile(path.join(appRoot, "index.html"), renderIndexHtml(base), "utf8");
  await writeFile(path.join(srcRoot, "registry.ts"), renderRegistry(entries), "utf8");
  await writeFile(path.join(srcRoot, "main.ts"), MAIN_TS, "utf8");
  return appRoot;
}

function renderTsconfig(workspaceRoot: string) {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        ignoreDeprecations: "6.0",
        strict: true,
        jsx: "react-jsx",
        esModuleInterop: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts", `${workspaceRoot}/components/**/*.ts`],
    },
    null,
    2
  )}\n`;
}

function renderIndexHtml(base: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>bit-lite webpack preview</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="${base}main.js"></script>
  </body>
</html>
`;
}

function renderRegistry(entries: PreviewEntry[]) {
  const rendered = entries.map((entry) => {
    const docsImport = entry.docsFile ? `() => import(${JSON.stringify(`${entry.docsFile}?raw`)})` : "undefined";
    return `{
      id: ${JSON.stringify(entry.id)},
      envName: ${JSON.stringify(entry.envName)},
      rootDir: ${JSON.stringify(entry.rootDir)},
      preview: () => import(${JSON.stringify(entry.previewFile)}),
      docs: ${docsImport}
    }`;
  });
  return `export const previews = [${rendered.join(",")}];\n`;
}

function requireWorkspaceRoot(context: { workspaceRoot?: string } | undefined) {
  if (!context?.workspaceRoot) throw new Error("preview requires workspaceRoot in context");
  return context.workspaceRoot;
}

function createCssFallbackRules(userRules: unknown, styleLoaderPath: string): RuleSetRule[] {
  if (hasCssRule(userRules)) return [];
  return [
    {
      test: /\.css$/,
      use: [styleLoaderPath],
    },
  ];
}

function hasCssRule(rules: unknown): boolean {
  return readRules(rules).some((rule) => ruleReferencesCss(rule, new Set()));
}

function ruleReferencesCss(rule: unknown, seen: Set<unknown>): boolean {
  if (typeof rule !== "object" || rule === null) return false;
  if (seen.has(rule)) return false;
  seen.add(rule);
  const candidate = rule as Record<string, unknown>;
  return (
    conditionReferencesCss(candidate.test) ||
    conditionReferencesCss(candidate.resource) ||
    conditionReferencesCss(candidate.resourceQuery) ||
    ruleListReferencesCss(candidate.rules, seen) ||
    ruleListReferencesCss(candidate.oneOf, seen)
  );
}

function ruleListReferencesCss(rules: unknown, seen: Set<unknown>) {
  return readRules(rules).some((rule) => ruleReferencesCss(rule, seen));
}

function conditionReferencesCss(value: unknown): boolean {
  if (value instanceof RegExp) return value.test("file.css") || value.test("?vue&type=style&lang=css");
  if (typeof value === "string") return value.includes(".css") || value.includes("lang=css") || value.includes("type=style");
  if (Array.isArray(value)) return value.some(conditionReferencesCss);
  if (typeof value !== "object" || value === null) return false;
  const condition = value as Record<string, unknown>;
  return Object.values(condition).some(conditionReferencesCss);
}

const STYLE_INJECT_LOADER = `module.exports = function bitLiteStyleInjectLoader(source) {
  const css = JSON.stringify(String(source));
  return [
    "const css = " + css + ";",
    "if (typeof document !== 'undefined') {",
    "  const style = document.createElement('style');",
    "  style.setAttribute('data-bit-lite-preview-style', '');",
    "  style.textContent = css;",
    "  document.head.appendChild(style);",
    "}",
    "export default css;"
  ].join("\\n");
};
`;

const MAIN_TS = `import { previews } from "./registry";

type PreviewMeta = {
  id: string;
  envName: string;
  rootDir: string;
  preview: () => Promise<PreviewModule>;
  docs?: () => Promise<RawModule>;
};

type RawModule = {
  default: string;
};

type PreviewModule = {
  default?: PreviewExport;
  mount?: PreviewMount;
  render?: PreviewRender;
};

type PreviewExport = PreviewMount | { mount?: PreviewMount; render?: PreviewRender };
type PreviewMount = (root: HTMLElement, meta: PreviewMeta) => unknown | Promise<unknown>;
type PreviewRender = (meta: PreviewMeta) => string | HTMLElement | Promise<string | HTMLElement>;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("missing #app");

const selectedId = new URLSearchParams(window.location.search).get("component") ?? previews[0]?.id;
const selectedView = new URLSearchParams(window.location.search).get("view") ?? "preview";

app.innerHTML = '<main class="stage"><div id="preview-root"></div></main>';
mountStyle();

const previewRoot = app.querySelector<HTMLElement>("#preview-root")!;
const selected = (previews as PreviewMeta[]).find((preview) => preview.id === selectedId) ?? previews[0];
if (!selected) {
  previewRoot.textContent = "No component preview files were found.";
} else if (selectedView === "docs") {
  await mountDocs(selected, previewRoot);
} else {
  await mountPreview(selected, previewRoot);
}

async function mountPreview(meta: PreviewMeta, root: HTMLElement) {
  root.replaceChildren();
  const mod = await meta.preview();
  const preview = mod.default ?? mod.mount ?? mod.render;
  if (typeof preview === "function") {
    await preview(root, meta);
    return;
  }
  if (preview?.mount) {
    await preview.mount(root, meta);
    return;
  }
  if (preview?.render) {
    const rendered = await preview.render(meta);
    if (typeof rendered === "string") root.innerHTML = rendered;
    else root.replaceChildren(rendered);
    return;
  }
  throw new Error("Preview module must export a mount function or render function.");
}

async function mountDocs(meta: PreviewMeta, root: HTMLElement) {
  root.replaceChildren();
  if (!meta.docs) {
    root.innerHTML = '<div class="empty">No docs file found for this component.</div>';
    return;
  }
  const markdown = (await meta.docs()).default;
  const article = document.createElement("article");
  article.className = "docs";
  article.innerHTML = renderMarkdown(markdown);
  root.appendChild(article);
}

function renderMarkdown(markdown: string) {
  return markdown
    .split(/\\r?\\n/)
    .map((line) => {
      const heading = line.match(/^(#{1,4})\\s+(.*)$/);
      if (heading) {
        const level = heading[1]?.length ?? 1;
        return '<h' + level + '>' + escapeHtml(heading[2] ?? "") + '</h' + level + '>';
      }
      if (!line.trim()) return "";
      return '<p>' + escapeHtml(line) + '</p>';
    })
    .join("\\n");
}

function mountStyle() {
  const style = document.createElement("style");
  style.textContent = \`
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #20242b;
      background: #fff;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .stage {
      min-height: 100vh;
      padding: 32px;
    }
    .docs {
      max-width: 760px;
      line-height: 1.65;
    }
  \`;
  document.head.appendChild(style);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
`;

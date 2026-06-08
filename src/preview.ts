import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import type { PluginOption, ViteDevServer } from "vite";
import { BitLiteError } from "./errors.js";
import { toPosixPath } from "./path-utils.js";
import type { ComponentRef, EnvRuntime, ServiceFactory, ServiceResult } from "./types.js";

const require = createRequire(import.meta.url);

type PreviewFramework = "html" | "react" | "vue";

type PreviewServiceConfig = {
  framework?: PreviewFramework;
  port?: number;
  host?: string;
  strictPort?: boolean;
  previewPatterns?: string[];
};

type PreviewEntry = {
  id: string;
  envName: string;
  framework: PreviewFramework;
  rootDir: string;
  previewFile: string;
};

const DEFAULT_PORT = 3100;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PREVIEW_PATTERNS = [
  "preview.ts",
  "preview.tsx",
  "preview.js",
  "preview.jsx",
  "*.preview.ts",
  "*.preview.tsx",
  "*.preview.js",
  "*.preview.jsx",
  "*.preview.vue",
];

export const createPreviewService: ServiceFactory = (config) => ({
  name: "preview",
  async run() {
    return {
      ok: false,
      message: "preview must run at workspace level",
    };
  },
  async runWorkspace(context) {
    const fallbackConfig = readPreviewConfig(config);
    const entries = await discoverPreviewEntries(context.groups, context.serviceConfigs, fallbackConfig);
    if (entries.length === 0) {
      throw new BitLiteError("preview could not find any component preview files");
    }

    const appRoot = await generatePreviewApp(entries);
    const plugins = await loadFrameworkPlugins(entries);
    const server = await createServer({
      root: appRoot,
      configFile: false,
      clearScreen: false,
      plugins,
      server: {
        host: fallbackConfig.host ?? DEFAULT_HOST,
        port: fallbackConfig.port ?? DEFAULT_PORT,
        strictPort: fallbackConfig.strictPort ?? false,
        fs: {
          allow: [context.workspaceRoot, appRoot],
        },
      },
    });

    await server.listen();
    const url = firstUrl(server) ?? `http://${fallbackConfig.host ?? DEFAULT_HOST}:${fallbackConfig.port ?? DEFAULT_PORT}/`;
    console.log(`preview running at ${url}`);
    return waitForClose(server, url);
  },
});

async function discoverPreviewEntries(
  groups: EnvRuntime[],
  serviceConfigs: Record<string, unknown>,
  fallbackConfig: PreviewServiceConfig
) {
  const entries: PreviewEntry[] = [];
  for (const group of groups) {
    const envConfig = {
      ...fallbackConfig,
      ...readPreviewConfig(serviceConfigs[group.envName]),
    };
    for (const component of group.components) {
      const previewFile = await findPreviewFile(component, envConfig.previewPatterns ?? DEFAULT_PREVIEW_PATTERNS);
      if (!previewFile) continue;
      entries.push({
        id: component.id,
        envName: group.envName,
        framework: envConfig.framework ?? "html",
        rootDir: component.rootDir,
        previewFile,
      });
    }
  }
  return entries.sort((left, right) => left.id.localeCompare(right.id));
}

async function findPreviewFile(component: ComponentRef, patterns: string[]) {
  let entries;
  try {
    entries = await readdir(component.rootDir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const match = files.find((fileName) => patterns.some((pattern) => matchPreviewPattern(fileName, pattern)));
  return match ? path.join(component.rootDir, match) : undefined;
}

function matchPreviewPattern(fileName: string, pattern: string) {
  if (!pattern.includes("*")) return fileName === pattern;
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[\\^$+?.()|[\]{}]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(fileName);
}

async function loadFrameworkPlugins(entries: PreviewEntry[]): Promise<PluginOption[]> {
  const frameworks = new Set(entries.map((entry) => entry.framework));
  const plugins: PluginOption[] = [];
  if (frameworks.has("react")) {
    const plugin = await loadOptionalVitePlugin("@vitejs/plugin-react");
    if (plugin) plugins.push(plugin());
  }
  if (frameworks.has("vue")) {
    const plugin = await loadOptionalVitePlugin("@vitejs/plugin-vue");
    if (plugin) plugins.push(plugin());
  }
  return plugins;
}

async function loadOptionalVitePlugin(packageName: string): Promise<undefined | (() => PluginOption)> {
  let packagePath: string;
  try {
    packagePath = require.resolve(packageName);
  } catch {
    console.warn(`preview: ${packageName} is not installed; continuing without it`);
    return undefined;
  }
  const mod = (await import(pathToFileURL(packagePath).href)) as { default?: unknown };
  return typeof mod.default === "function" ? (mod.default as () => PluginOption) : undefined;
}

async function generatePreviewApp(entries: PreviewEntry[]) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-preview-"));
  const srcRoot = path.join(appRoot, "src");
  await mkdir(srcRoot, { recursive: true });
  await writeFile(path.join(appRoot, "index.html"), INDEX_HTML, "utf8");
  await writeFile(path.join(srcRoot, "registry.ts"), renderRegistry(entries), "utf8");
  await writeFile(path.join(srcRoot, "main.ts"), MAIN_TS, "utf8");
  await writeFile(path.join(srcRoot, "style.css"), STYLE_CSS, "utf8");
  return appRoot;
}

function renderRegistry(entries: PreviewEntry[]) {
  const serialized = entries.map((entry) => ({
    id: entry.id,
    envName: entry.envName,
    framework: entry.framework,
    rootDir: entry.rootDir,
    modulePath: `/@fs${toPosixPath(entry.previewFile)}`,
  }));
  return `export const previews = ${JSON.stringify(serialized, null, 2)};\n`;
}

function readPreviewConfig(value: unknown): PreviewServiceConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const config: PreviewServiceConfig = {};
  if (input.framework === "html" || input.framework === "react" || input.framework === "vue") {
    config.framework = input.framework;
  }
  if (typeof input.port === "number") config.port = input.port;
  if (typeof input.host === "string") config.host = input.host;
  if (typeof input.strictPort === "boolean") config.strictPort = input.strictPort;
  if (Array.isArray(input.previewPatterns)) {
    config.previewPatterns = input.previewPatterns.filter((item): item is string => typeof item === "string");
  }
  return config;
}

function firstUrl(server: ViteDevServer) {
  return server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0];
}

function waitForClose(server: ViteDevServer, url: string): Promise<ServiceResult> {
  return new Promise((resolve) => {
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      process.off("SIGINT", close);
      process.off("SIGTERM", close);
      await server.close();
      resolve({
        ok: true,
        message: `preview stopped at ${url}`,
      });
    };
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
  });
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>bit-lite preview</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

const MAIN_TS = `import "./style.css";
import { previews } from "./registry";

type PreviewMeta = {
  id: string;
  envName: string;
  framework: "html" | "react" | "vue";
  rootDir: string;
  modulePath: string;
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

app.innerHTML = \`
  <aside class="sidebar">
    <div class="brand">bit-lite</div>
    <nav class="nav"></nav>
  </aside>
  <main class="main">
    <header class="header">
      <div>
        <div class="eyebrow"></div>
        <h1></h1>
      </div>
      <div class="badge"></div>
    </header>
    <section class="stage">
      <div id="preview-root"></div>
    </section>
  </main>
\`;

const nav = app.querySelector<HTMLElement>(".nav")!;
const title = app.querySelector<HTMLHeadingElement>("h1")!;
const eyebrow = app.querySelector<HTMLElement>(".eyebrow")!;
const badge = app.querySelector<HTMLElement>(".badge")!;
const previewRoot = app.querySelector<HTMLElement>("#preview-root")!;

for (const preview of previews as PreviewMeta[]) {
  const link = document.createElement("a");
  link.href = \`/?component=\${encodeURIComponent(preview.id)}\`;
  link.className = preview.id === selectedId ? "active" : "";
  link.textContent = preview.id;
  nav.appendChild(link);
}

const selected = (previews as PreviewMeta[]).find((preview) => preview.id === selectedId) ?? previews[0];
if (!selected) {
  title.textContent = "No previews";
  previewRoot.textContent = "No component preview files were found.";
} else {
  title.textContent = selected.id;
  eyebrow.textContent = selected.envName;
  badge.textContent = selected.framework;
  await mountPreview(selected, previewRoot);
}

async function mountPreview(meta: PreviewMeta, root: HTMLElement) {
  root.replaceChildren();
  const mod = (await import(/* @vite-ignore */ meta.modulePath)) as PreviewModule;
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
  throw new Error(\`Preview module for "\${meta.id}" must export a mount function or render function.\`);
}
`;

const STYLE_CSS = `* {
  box-sizing: border-box;
}

body {
  margin: 0;
  color: #1b1f24;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f6f7f9;
}

#app {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  border-right: 1px solid #d9dee7;
  background: #ffffff;
  padding: 20px 14px;
}

.brand {
  margin: 0 8px 18px;
  font-size: 14px;
  font-weight: 700;
}

.nav {
  display: grid;
  gap: 4px;
}

.nav a {
  color: #343b45;
  text-decoration: none;
  border-radius: 7px;
  padding: 9px 10px;
  font-size: 14px;
}

.nav a:hover,
.nav a.active {
  background: #edf1f7;
  color: #111827;
}

.main {
  min-width: 0;
  display: grid;
  grid-template-rows: auto 1fr;
}

.header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  border-bottom: 1px solid #d9dee7;
  padding: 18px 24px;
  background: #ffffff;
}

.eyebrow {
  color: #667085;
  font-size: 12px;
  line-height: 1.4;
}

h1 {
  margin: 2px 0 0;
  font-size: 20px;
  line-height: 1.2;
}

.badge {
  border: 1px solid #cfd6e1;
  border-radius: 999px;
  padding: 4px 10px;
  background: #f9fafb;
  color: #3d4654;
  font-size: 12px;
}

.stage {
  padding: 28px;
}

#preview-root {
  min-height: 320px;
  border: 1px solid #d9dee7;
  border-radius: 8px;
  background: #ffffff;
  padding: 28px;
}

@media (max-width: 760px) {
  #app {
    grid-template-columns: 1fr;
  }

  .sidebar {
    border-right: 0;
    border-bottom: 1px solid #d9dee7;
  }
}
`;

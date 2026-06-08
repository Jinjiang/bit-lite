import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer as createViteServer } from "vite";
import type { PluginOption, ViteDevServer } from "vite";
import { toPosixPath } from "./path-utils.js";
import type { ComponentRef, ServiceFactory, ServiceResult } from "./types.js";

const require = createRequire(import.meta.url);

type PreviewFramework = "html" | "react" | "vue";

type PreviewServiceConfig = {
  framework?: PreviewFramework;
  port?: number;
  host?: string;
  centralPort?: number;
  centralHost?: string;
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

type RunningEnvPreview = {
  envName: string;
  framework: PreviewFramework;
  host: string;
  port: number;
  base: string;
  url: string;
  components: PreviewEntry[];
};

type PreviewCoordinator = {
  server: HttpServer;
  host: string;
  port: number;
  url: string;
  envs: Map<string, RunningEnvPreview>;
};

const DEFAULT_ENV_PORT = 3100;
const DEFAULT_CENTRAL_PORT = 3000;
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

const viteServers = new Set<ViteDevServer>();
let coordinator: PreviewCoordinator | undefined;
let nextEnvPort = DEFAULT_ENV_PORT;
let signalHandlersInstalled = false;

export const createPreviewService: ServiceFactory = (config) => ({
  name: "preview",
  async run(context) {
    const serviceConfig = {
      ...readPreviewConfig(config),
      ...readPreviewConfig(context.serviceConfig),
    };
    const framework = serviceConfig.framework ?? "html";
    const entries = await discoverPreviewEntries(context.components, context.envName, framework, serviceConfig);
    if (entries.length === 0) {
      return {
        ok: true,
        message: `preview found no preview files for ${context.envName}`,
      };
    }

    const central = await ensureCoordinator(serviceConfig);
    const port = serviceConfig.port ?? nextPreviewPort();
    const host = serviceConfig.host ?? DEFAULT_HOST;
    const base = `/env/${encodeURIComponent(context.envName)}/`;
    const appRoot = await generatePreviewApp(entries, base);
    const plugins = await loadFrameworkPlugins(framework);
    const server = await createViteServer({
      root: appRoot,
      base,
      configFile: false,
      clearScreen: false,
      plugins,
      server: {
        host,
        port,
        strictPort: serviceConfig.strictPort ?? true,
        fs: {
          allow: [context.workspaceRoot, appRoot],
        },
      },
    });

    await server.listen();
    viteServers.add(server);
    const url = firstUrl(server) ?? `http://${host}:${port}${base}`;
    central.envs.set(context.envName, {
      envName: context.envName,
      framework,
      host,
      port,
      base,
      url,
      components: entries,
    });
    installSignalHandlers();

    return {
      ok: true,
      message: `preview ${context.envName} running at ${url}; central preview at ${central.url}`,
    };
  },
});

async function discoverPreviewEntries(
  components: ComponentRef[],
  envName: string,
  framework: PreviewFramework,
  config: PreviewServiceConfig
) {
  const entries: PreviewEntry[] = [];
  for (const component of components) {
    const previewFile = await findPreviewFile(component, config.previewPatterns ?? DEFAULT_PREVIEW_PATTERNS);
    if (!previewFile) continue;
    entries.push({
      id: component.id,
      envName,
      framework,
      rootDir: component.rootDir,
      previewFile,
    });
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

async function ensureCoordinator(config: PreviewServiceConfig): Promise<PreviewCoordinator> {
  if (coordinator) return coordinator;
  const host = config.centralHost ?? config.host ?? DEFAULT_HOST;
  const port = config.centralPort ?? DEFAULT_CENTRAL_PORT;
  const server = createHttpServer(handleCentralRequest);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  coordinator = {
    server,
    host,
    port,
    url: `http://${host}:${port}/`,
    envs: new Map(),
  };
  return coordinator;
}

function handleCentralRequest(req: IncomingMessage, res: ServerResponse) {
  if (!coordinator || !req.url) {
    sendText(res, 503, "preview coordinator is not ready");
    return;
  }

  const url = new URL(req.url, coordinator.url);
  if (url.pathname === "/") {
    sendHtml(res, CENTRAL_INDEX_HTML);
    return;
  }
  if (url.pathname === "/api/previews") {
    sendJson(res, getPreviewRegistry());
    return;
  }
  const envMatch = url.pathname.match(/^\/env\/([^/]+)(\/.*)?$/);
  if (envMatch) {
    proxyEnvRequest(req, res, decodeURIComponent(envMatch[1] ?? ""));
    return;
  }
  sendText(res, 404, "not found");
}

function proxyEnvRequest(req: IncomingMessage, res: ServerResponse, envName: string) {
  const env = coordinator?.envs.get(envName);
  if (!env || !req.url) {
    sendText(res, 404, `preview env "${envName}" is not running`);
    return;
  }

  const proxyReq = httpRequest(
    {
      hostname: env.host,
      port: env.port,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", (error) => {
    sendText(res, 502, `failed proxying "${envName}": ${error.message}`);
  });
  req.pipe(proxyReq);
}

function getPreviewRegistry() {
  const envs = Array.from(coordinator?.envs.values() ?? []).sort((left, right) => left.envName.localeCompare(right.envName));
  return {
    envs: envs.map((env) => ({
      envName: env.envName,
      framework: env.framework,
      url: env.url,
      proxyBase: env.base,
      components: env.components.map((component) => ({
        id: component.id,
        rootDir: component.rootDir,
      })),
    })),
  };
}

function sendHtml(res: ServerResponse, body: string) {
  res.writeHead(200, { "content-type": "text/html; charset=utf8" });
  res.end(body);
}

function sendJson(res: ServerResponse, body: unknown) {
  res.writeHead(200, { "content-type": "application/json; charset=utf8" });
  res.end(JSON.stringify(body, null, 2));
}

function sendText(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf8" });
  res.end(body);
}

function nextPreviewPort() {
  const port = nextEnvPort;
  nextEnvPort += 1;
  return port;
}

async function loadFrameworkPlugins(framework: PreviewFramework): Promise<PluginOption[]> {
  const plugins: PluginOption[] = [];
  if (framework === "react") {
    const plugin = await loadOptionalVitePlugin("@vitejs/plugin-react");
    if (plugin) plugins.push(plugin());
  }
  if (framework === "vue") {
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

async function generatePreviewApp(entries: PreviewEntry[], base: string) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-preview-"));
  const srcRoot = path.join(appRoot, "src");
  await mkdir(srcRoot, { recursive: true });
  await writeFile(path.join(appRoot, "index.html"), INDEX_HTML, "utf8");
  await writeFile(path.join(srcRoot, "registry.ts"), renderRegistry(entries, base), "utf8");
  await writeFile(path.join(srcRoot, "main.ts"), MAIN_TS, "utf8");
  await writeFile(path.join(srcRoot, "style.css"), STYLE_CSS, "utf8");
  return appRoot;
}

function renderRegistry(entries: PreviewEntry[], base: string) {
  const serialized = entries.map((entry) => ({
    id: entry.id,
    envName: entry.envName,
    framework: entry.framework,
    rootDir: entry.rootDir,
    modulePath: `${base}@fs${toPosixPath(entry.previewFile)}`,
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
  if (typeof input.centralPort === "number") config.centralPort = input.centralPort;
  if (typeof input.centralHost === "string") config.centralHost = input.centralHost;
  if (typeof input.strictPort === "boolean") config.strictPort = input.strictPort;
  if (Array.isArray(input.previewPatterns)) {
    config.previewPatterns = input.previewPatterns.filter((item): item is string => typeof item === "string");
  }
  return config;
}

function firstUrl(server: ViteDevServer) {
  return server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0];
}

function installSignalHandlers() {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  const close = async () => {
    process.off("SIGINT", close);
    process.off("SIGTERM", close);
    for (const server of viteServers) {
      await server.close();
    }
    await new Promise<void>((resolve) => coordinator?.server.close(() => resolve()) ?? resolve());
    console.log("preview stopped");
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
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
    <script type="module" src="./src/main.ts"></script>
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
  <main class="stage">
    <div id="preview-root"></div>
  </main>
\`;

const previewRoot = app.querySelector<HTMLElement>("#preview-root")!;

const selected = (previews as PreviewMeta[]).find((preview) => preview.id === selectedId) ?? previews[0];
if (!selected) {
  previewRoot.textContent = "No component preview files were found.";
} else {
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

const CENTRAL_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>bit-lite previews</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #1b1f24;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f7f9;
      }
      #app {
        display: grid;
        grid-template-columns: 300px minmax(0, 1fr);
        min-height: 100vh;
      }
      aside {
        background: #fff;
        border-right: 1px solid #d9dee7;
        padding: 18px 14px;
      }
      h1 {
        margin: 0 8px 18px;
        font-size: 16px;
      }
      .group {
        margin: 0 0 18px;
      }
      .group-title {
        color: #667085;
        font-size: 12px;
        margin: 0 8px 6px;
      }
      a {
        display: block;
        color: #343b45;
        text-decoration: none;
        border-radius: 7px;
        padding: 9px 10px;
        font-size: 14px;
      }
      a:hover, a.active {
        background: #edf1f7;
        color: #111827;
      }
      iframe {
        width: 100%;
        height: 100vh;
        border: 0;
        background: #fff;
      }
    </style>
  </head>
  <body>
    <div id="app">
      <aside>
        <h1>bit-lite previews</h1>
        <nav id="nav"></nav>
      </aside>
      <iframe id="frame" title="preview"></iframe>
    </div>
    <script type="module">
      const nav = document.querySelector("#nav");
      const frame = document.querySelector("#frame");
      const params = new URLSearchParams(location.search);
      const selected = params.get("component");
      const registry = await fetch("/api/previews").then((res) => res.json());
      let firstHref;
      for (const env of registry.envs) {
        const group = document.createElement("section");
        group.className = "group";
        group.innerHTML = '<div class="group-title">' + env.envName + ' / ' + env.framework + '</div>';
        for (const component of env.components) {
          const href = env.proxyBase + "?component=" + encodeURIComponent(component.id);
          firstHref ??= href;
          const link = document.createElement("a");
          link.href = "?component=" + encodeURIComponent(component.id);
          link.textContent = component.id;
          link.className = component.id === selected ? "active" : "";
          link.addEventListener("click", (event) => {
            event.preventDefault();
            history.pushState(null, "", link.href);
            document.querySelectorAll("a").forEach((item) => item.classList.remove("active"));
            link.classList.add("active");
            frame.src = href;
          });
          group.appendChild(link);
          if (component.id === selected) frame.src = href;
        }
        nav.appendChild(group);
      }
      if (!frame.src && firstHref) frame.src = firstHref;
    </script>
  </body>
</html>
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
  display: block;
  min-height: 100vh;
}

.stage {
  padding: 28px;
}

#preview-root {
  min-height: calc(100vh - 56px);
  background: #ffffff;
  padding: 28px;
}
`;

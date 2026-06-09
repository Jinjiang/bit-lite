import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer as createViteServer } from "vite";
import type { PluginOption, ViteDevServer } from "vite";
import { fileHasKind, findFilesByKind, findFirstFileByKind } from "./file-matcher.js";
import { toPosixPath } from "./path-utils.js";
import type { ComponentRef, ServiceFactory, ServiceResult } from "./types.js";

const require = createRequire(import.meta.url);

type PreviewFramework = "html" | "react" | "vue";

type PreviewServiceConfig = {
  framework?: PreviewFramework;
  host?: string;
  centralHost?: string;
  strictPort?: boolean;
  start?: boolean;
};

type PreviewEntry = {
  id: string;
  envName: string;
  framework: PreviewFramework;
  rootDir: string;
  previewFile: string;
  docsFile?: string;
  sourceFile?: string;
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

const DEFAULT_ENV_PORT = 3301;
const DEFAULT_CENTRAL_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";

const viteServers = new Set<ViteDevServer>();
let coordinator: PreviewCoordinator | undefined;
let nextEnvPort = DEFAULT_ENV_PORT;
let signalHandlersInstalled = false;
type TestWatcherState = {
  envName: string;
  process?: ChildProcess;
  output: string;
  status: "idle" | "running" | "exited";
  exitCode?: number;
};
const testWatchers = new Map<string, TestWatcherState>();

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

    const central = await ensureCoordinator(serviceConfig, context.workspaceRoot, context.envName, context.components);
    const port = nextPreviewPort();
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
    const previewFile = await findFirstFileByKind(component.rootDir, "preview");
    if (!previewFile) continue;
    const docsFile = await findFirstFileByKind(component.rootDir, "docs");
    const sourceFile = await findSourceFile(component.rootDir);
    entries.push({
      id: component.id,
      envName,
      framework,
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

async function ensureCoordinator(
  config: PreviewServiceConfig,
  workspaceRoot: string,
  envName: string,
  components: ComponentRef[]
): Promise<PreviewCoordinator> {
  if (coordinator) {
    if (config.start) await startTestWatcher(workspaceRoot, envName, components);
    return coordinator;
  }
  const host = config.centralHost ?? config.host ?? DEFAULT_HOST;
  const port = DEFAULT_CENTRAL_PORT;
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
  if (config.start) await startTestWatcher(workspaceRoot, envName, components);
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
  if (url.pathname === "/api/tests") {
    sendJson(res, getTestWatcherState(url.searchParams.get("env") ?? undefined));
    return;
  }
  if (url.pathname === "/tests") {
    sendHtml(res, TESTS_HTML);
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
        hasDocs: Boolean(component.docsFile),
        hasSource: Boolean(component.sourceFile),
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
    docsModulePath: entry.docsFile ? `${base}@fs${toPosixPath(entry.docsFile)}?raw` : undefined,
    sourceModulePath: entry.sourceFile ? `${base}@fs${toPosixPath(entry.sourceFile)}?raw` : undefined,
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
  if (typeof input.host === "string") config.host = input.host;
  if (typeof input.centralHost === "string") config.centralHost = input.centralHost;
  if (typeof input.strictPort === "boolean") config.strictPort = input.strictPort;
  if (typeof input.start === "boolean") config.start = input.start;
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
    for (const watcher of testWatchers.values()) {
      watcher.process?.kill();
    }
    await new Promise<void>((resolve) => coordinator?.server.close(() => resolve()) ?? resolve());
    console.log("start stopped");
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

async function startTestWatcher(workspaceRoot: string, envName: string, components: ComponentRef[]) {
  if (testWatchers.get(envName)?.process) return;
  const vitestPath = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
  const testFiles = await findTestFiles(components);
  const state: TestWatcherState = {
    envName,
    status: testFiles.length > 0 ? "running" : "idle",
    output:
      testFiles.length > 0
        ? `Starting tests for ${envName}...`
        : `No test files found for ${envName}.`,
  };
  testWatchers.set(envName, state);
  if (testFiles.length === 0) return;
  state.process = spawn(process.execPath, [vitestPath, "--watch", ...testFiles], {
    cwd: workspaceRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  state.process.stdout?.on("data", (chunk) => appendTestOutput(state, String(chunk)));
  state.process.stderr?.on("data", (chunk) => appendTestOutput(state, String(chunk)));
  state.process.on("exit", (code) => {
    state.status = "exited";
    if (code !== null) state.exitCode = code;
    appendTestOutput(state, `\nTest watcher for ${envName} exited with code ${code ?? 1}.\n`);
  });
}

async function findTestFiles(components: ComponentRef[]) {
  const files = await Promise.all(
    components.map(async (component) => {
      const testFiles = await findFilesByKind(component.rootDir, "test");
      const specFiles = await findFilesByKind(component.rootDir, "spec");
      return [...testFiles, ...specFiles];
    })
  );
  return files.flat().sort();
}

function appendTestOutput(state: TestWatcherState, chunk: string) {
  state.output += stripAnsi(chunk);
  if (state.output.length > 20000) {
    state.output = state.output.slice(state.output.length - 20000);
  }
}

function getTestWatcherState(envName?: string) {
  if (envName) {
    const state = testWatchers.get(envName);
    if (!state) {
      return {
        envName,
        status: "idle",
        output: `Tests have not started for ${envName}.`,
      };
    }
    return serializeTestWatcher(state);
  }
  return {
    envs: Array.from(testWatchers.values())
      .sort((left, right) => left.envName.localeCompare(right.envName))
      .map(serializeTestWatcher),
  };
}

function serializeTestWatcher(state: TestWatcherState) {
  return {
    envName: state.envName,
    status: state.status,
    exitCode: state.exitCode,
    output: state.output,
  };
}

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
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
  docsModulePath?: string;
  sourceModulePath?: string;
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

app.innerHTML = \`
  <main class="stage">
    <div id="preview-root"></div>
  </main>
\`;

const previewRoot = app.querySelector<HTMLElement>("#preview-root")!;

const selected = (previews as PreviewMeta[]).find((preview) => preview.id === selectedId) ?? previews[0];
if (!selected) {
  previewRoot.textContent = "No component preview files were found.";
} else if (selectedView === "docs") {
  await mountDocs(selected, previewRoot);
} else if (selectedView === "source") {
  await mountSource(selected, previewRoot);
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

async function mountDocs(meta: PreviewMeta, root: HTMLElement) {
  root.replaceChildren();
  if (!meta.docsModulePath) {
    root.innerHTML = '<div class="empty">No docs file found for this component.</div>';
    return;
  }
  const markdown = (await import(/* @vite-ignore */ meta.docsModulePath)).default as string;
  const article = document.createElement("article");
  article.className = "docs";
  article.innerHTML = renderMarkdown(markdown);
  root.appendChild(article);
}

async function mountSource(meta: PreviewMeta, root: HTMLElement) {
  root.replaceChildren();
  if (!meta.sourceModulePath) {
    root.innerHTML = '<div class="empty">No source file found for this component.</div>';
    return;
  }
  const source = (await import(/* @vite-ignore */ meta.sourceModulePath)).default as string;
  const pre = document.createElement("pre");
  pre.className = "source";
  const code = document.createElement("code");
  code.textContent = source;
  pre.appendChild(code);
  root.appendChild(pre);
}

function renderMarkdown(markdown: string) {
  const lines = markdown.split(/\\r?\\n/);
  const html: string[] = [];
  let paragraph: string[] = [];
  let inCode = false;
  let code: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push('<p>' + inlineMarkdown(paragraph.join(" ")) + '</p>');
    paragraph = [];
  };

  for (const line of lines) {
    if (line.startsWith("\`\`\`")) {
      if (inCode) {
        html.push('<pre><code>' + escapeHtml(code.join("\\n")) + '</code></pre>');
        code = [];
        inCode = false;
      } else {
        flushParagraph();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    const heading = line.match(/^(#{1,4})\\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      html.push('<h' + level + '>' + inlineMarkdown(heading[2]) + '</h' + level + '>');
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  if (inCode) html.push('<pre><code>' + escapeHtml(code.join("\\n")) + '</code></pre>');
  return html.join("\\n");
}

function inlineMarkdown(value: string) {
  const tick = String.fromCharCode(96);
  return escapeHtml(value)
    .replace(new RegExp(tick + '([^' + tick + ']+)' + tick, 'g'), '<code>$1</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
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
        display: inline-flex;
        color: #343b45;
        text-decoration: none;
        border-radius: 7px;
        padding: 7px 9px;
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
      .component-row {
        display: grid;
        gap: 4px;
        margin: 0 0 8px;
      }
      .component-name {
        color: #111827;
        font-size: 14px;
        padding: 0 8px;
      }
      .actions {
        display: flex;
        gap: 4px;
        padding: 0 0 0 2px;
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
      const selectedView = params.get("view") ?? "preview";
      const registry = await fetch("/api/previews").then((res) => res.json());
      let firstHref;
      for (const env of registry.envs) {
        const group = document.createElement("section");
        group.className = "group";
        group.innerHTML = '<div class="group-title">' + env.envName + ' / ' + env.framework + '</div>';
        for (const component of env.components) {
          const row = document.createElement("div");
          row.className = "component-row";
          row.innerHTML = '<div class="component-name">' + component.id + '</div>';
          const actions = document.createElement("div");
          actions.className = "actions";
          row.appendChild(actions);
          actions.appendChild(createAction(env, component, "preview", "Demo"));
          if (component.hasDocs) actions.appendChild(createAction(env, component, "docs", "Docs"));
          if (component.hasSource) actions.appendChild(createAction(env, component, "source", "Source"));
          actions.appendChild(createAction(env, component, "tests", "Tests"));
          group.appendChild(row);
        }
        nav.appendChild(group);
      }
      if (!frame.src && firstHref) frame.src = firstHref;

      function createAction(env, component, view, label) {
        const href =
          view === "tests"
            ? "/tests?env=" + encodeURIComponent(env.envName) + "&component=" + encodeURIComponent(component.id)
            : env.proxyBase + "?component=" + encodeURIComponent(component.id) + "&view=" + view;
        firstHref ??= href;
        const link = document.createElement("a");
        link.href = "?component=" + encodeURIComponent(component.id) + "&view=" + view;
        link.textContent = label;
        link.className = component.id === selected && selectedView === view ? "active" : "";
        link.addEventListener("click", (event) => {
          event.preventDefault();
          history.pushState(null, "", link.href);
          document.querySelectorAll("a").forEach((item) => item.classList.remove("active"));
          link.classList.add("active");
          frame.src = href;
        });
        if (component.id === selected && selectedView === view) frame.src = href;
        return link;
      }
    </script>
  </body>
</html>
`;

const TESTS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>bit-lite tests</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #1b1f24;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #fff;
      }
      main {
        min-height: 100vh;
        padding: 28px;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin: 0 0 18px;
      }
      h1 {
        margin: 0;
        font-size: 20px;
      }
      .status {
        border: 1px solid #cfd6e1;
        border-radius: 999px;
        padding: 4px 10px;
        color: #3d4654;
        background: #f9fafb;
        font-size: 12px;
      }
      pre {
        min-height: 420px;
        overflow: auto;
        margin: 0;
        border-radius: 8px;
        background: #111827;
        color: #f9fafb;
        padding: 16px;
        line-height: 1.45;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Tests</h1>
        <div class="status" id="status">loading</div>
      </header>
      <pre id="output">Loading test results...</pre>
    </main>
    <script type="module">
      const status = document.querySelector("#status");
      const output = document.querySelector("#output");
      const envName = new URLSearchParams(location.search).get("env");

      async function refresh() {
        const url = envName ? "/api/tests?env=" + encodeURIComponent(envName) : "/api/tests";
        const result = await fetch(url).then((res) => res.json());
        status.textContent =
          (result.envName ? result.envName + " / " : "") +
          result.status +
          (result.exitCode === undefined ? "" : " / " + result.exitCode);
        output.textContent = result.output || "No test output yet.";
      }

      await refresh();
      setInterval(refresh, 1000);
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

.empty {
  color: #667085;
}

.docs {
  max-width: 760px;
  line-height: 1.65;
}

.docs h1,
.docs h2,
.docs h3,
.docs h4 {
  line-height: 1.25;
  margin: 0 0 14px;
}

.docs p {
  margin: 0 0 14px;
}

.docs code {
  background: #eef2f7;
  border-radius: 4px;
  padding: 2px 5px;
}

.docs pre {
  overflow: auto;
  background: #111827;
  color: #f9fafb;
  border-radius: 8px;
  padding: 14px;
}

.docs pre code {
  background: transparent;
  padding: 0;
}

.source {
  overflow: auto;
  margin: 0;
  border-radius: 8px;
  background: #111827;
  color: #f9fafb;
  padding: 16px;
  line-height: 1.5;
}

.source code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}
`;

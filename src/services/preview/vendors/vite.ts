import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createLogger, createServer as createViteServer } from "vite";
import type { Logger, ViteDevServer } from "vite";
import { toPosixPath } from "../../../path-utils.js";
import { createServiceTask } from "../../../runtime.js";
import { readObjectConfig } from "../../../service-config.js";
import { registerPreviewVendorCloser } from "../runtime.js";
import type { PreviewEntry, PreviewVendor } from "../types.js";

const DEFAULT_HOST = "127.0.0.1";

export const vitePreviewVendor: PreviewVendor = {
  name: "vite",
  run(input, context) {
    return createServiceTask(async ({ emit }) => {
      const workspaceRoot = requireWorkspaceRoot(context);
      const config = readObjectConfig(input.config);
      const configFile = readConfigFile(config, workspaceRoot);
      const appRoot = await generatePreviewApp(input.entries, input.base);
      emit("output", { stream: "stdout", chunk: `starting vite preview on port ${input.port}\n` });
      const server = await createViteServer({
        root: appRoot,
        base: input.base,
        configFile: configFile ?? false,
        clearScreen: false,
        customLogger: createServiceLogger((stream, chunk) => emit("output", { stream, chunk })),
        server: {
          port: input.port,
          fs: {
            allow: [workspaceRoot, appRoot],
          },
        },
      });

      await server.listen();
      registerPreviewVendorCloser(() => server.close());
      const port = serverPort(server) ?? input.port;
      const host = serverHost(server);
      const url = firstUrl(server) ?? `http://${host}:${port}${input.base}`;
      emit("output", { stream: "stdout", chunk: `vite preview ready at ${url}\n` });
      emit("ready", { url, host, port, base: input.base });
      return {
        ok: true,
        message: `preview ${context?.envName} running at ${url}`,
        url,
        host,
        port,
        base: input.base,
      };
    });
  },
};

export default vitePreviewVendor;

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
    rootDir: entry.rootDir,
    modulePath: `${base}@fs${toPosixPath(entry.previewFile)}`,
    docsModulePath: entry.docsFile ? `${base}@fs${toPosixPath(entry.docsFile)}?raw` : undefined,
    sourceModulePath: entry.sourceFile ? `${base}@fs${toPosixPath(entry.sourceFile)}?raw` : undefined,
  }));
  return `export const previews = ${JSON.stringify(serialized, null, 2)};\n`;
}

function firstUrl(server: ViteDevServer) {
  return server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0];
}

function readConfigFile(config: Record<string, unknown>, workspaceRoot: string) {
  return typeof config.configFile === "string" ? path.resolve(workspaceRoot, config.configFile) : undefined;
}

function serverHost(server: ViteDevServer) {
  const host = server.config.server.host;
  return typeof host === "string" && host !== "0.0.0.0" ? host : DEFAULT_HOST;
}

function serverPort(server: ViteDevServer) {
  const address = server.httpServer?.address();
  if (typeof address === "object" && address !== null) return (address as AddressInfo).port;
  return undefined;
}

function requireWorkspaceRoot(context: { workspaceRoot?: string } | undefined) {
  if (!context?.workspaceRoot) throw new Error("preview requires workspaceRoot in context");
  return context.workspaceRoot;
}

function createServiceLogger(emitOutput: (stream: "stdout" | "stderr", chunk: string) => void): Logger {
  const logger = createLogger("info", { allowClearScreen: false });
  return {
    ...logger,
    info(message) {
      emitOutput("stdout", `${message}\n`);
    },
    warn(message) {
      emitOutput("stderr", `${message}\n`);
    },
    warnOnce(message) {
      emitOutput("stderr", `${message}\n`);
    },
    error(message) {
      emitOutput("stderr", `${message}\n`);
    },
    clearScreen() {},
  };
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
  background: #111827;
  color: #f9fafb;
  border-radius: 8px;
  padding: 16px;
  line-height: 1.45;
}
`;

import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import type { ComponentRef } from "bit-lite-context";
import type { JsonObject, VendorDefinition, VendorRuntime, VendorStartResult } from "bit-lite-vendors";

export type PreviewVendorRuntime = JsonObject & {
  host: string;
  port: number;
  basePath: string;
  proxyOrigin: string;
};

export type PreviewServerInfo = JsonObject & {
  origin: string;
  host: string;
  port: number;
  basePath: string;
};

export type PreviewServiceResult = JsonObject & {
  service: "preview";
  vendor: string;
  envName: string;
  mode: "serve";
  server: PreviewServerInfo;
};

type PreviewVendorConfig = {
  configFile: string;
  mounter?: string | undefined;
  docsTemplate?: string | undefined;
};

type PreviewDocsEntry = {
  title: string;
  source: string;
};

type PreviewCompositionEntry = {
  id: string;
  title: string;
  filePath: string;
};

type PreviewComponentEntry = {
  component: ComponentRef;
  docs?: PreviewDocsEntry | undefined;
  compositions: PreviewCompositionEntry[];
};

type MatchedPreviewRoute =
  | { entry: PreviewComponentEntry; kind: "docs" }
  | { entry: PreviewComponentEntry; kind: "compositions-list" }
  | { entry: PreviewComponentEntry; kind: "composition"; compositionId: string };

export async function startVitePreviewVendor(
  runtime: VendorRuntime<Record<string, unknown>, PreviewServiceResult, never, PreviewVendorRuntime>,
  meta: VendorDefinition
): Promise<VendorStartResult<PreviewServiceResult>> {
  const workspaceRoot = runtime.data.context?.workspaceRoot ?? process.cwd();
  const previewRuntime = readPreviewRuntime(runtime.data.runtime);
  const vendorConfig = readPreviewVendorConfig(runtime.data.config, workspaceRoot);
  let server: ViteDevServer | undefined;
  let stopped = false;
  let stopping: Promise<void> | undefined;

  const unsubscribe = runtime.onMessage(async (message) => {
    if (isShutdownMessage(message)) await stop();
  });

  runtime.postMessage({ type: "ready" });
  runtime.postMessage({ type: "status", status: "building" });

  try {
    const entries = await discoverPreviewEntries(runtime.data.components);
    server = await createServer({
      root: workspaceRoot,
      configFile: vendorConfig.configFile,
      base: previewRuntime.basePath,
      appType: "custom",
      server: {
        host: previewRuntime.host,
        port: previewRuntime.port,
        strictPort: true,
        hmr: createHmrOptions(previewRuntime),
      },
    });

    installPreviewRoutes(server, previewRuntime, vendorConfig, entries);
    await server.listen(previewRuntime.port);

    const serverInfo: PreviewServerInfo = {
      origin: `http://${previewRuntime.host}:${previewRuntime.port}`,
      host: previewRuntime.host,
      port: previewRuntime.port,
      basePath: previewRuntime.basePath,
    };
    const data: PreviewServiceResult = {
      service: "preview",
      vendor: meta.id,
      envName: runtime.data.envName,
      mode: "serve",
      server: serverInfo,
    };

    runtime.postMessage({ type: "result", data });
    runtime.postMessage({ type: "status", status: "ready" });
    return { stop };
  } catch (error) {
    runtime.postMessage({ type: "status", status: "error" });
    await stop();
    throw error;
  }

  async function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      if (stopped) return;
      stopped = true;
      const activeServer = server;
      server = undefined;
      await activeServer?.close();
      runtime.postMessage({ type: "status", status: "stopped" });
      unsubscribe();
    })();
    return stopping;
  }
}

function installPreviewRoutes(
  server: ViteDevServer,
  previewRuntime: PreviewVendorRuntime,
  vendorConfig: PreviewVendorConfig,
  entries: PreviewComponentEntry[]
) {
  server.middlewares.use(async (request, response, next) => {
    if (request.method !== "GET" || request.url === undefined) {
      next();
      return;
    }

    const route = matchPreviewRoute(request.url, previewRuntime.basePath, entries);
    if (!route) {
      next();
      return;
    }

    if (route.kind === "docs") {
      await sendPreviewHtml(
        server,
        request.url,
        response,
        route.entry.docs ? 200 : 404,
        renderDocsPage(route.entry, previewRuntime)
      );
      return;
    }

    if (route.kind === "compositions-list") {
      await sendPreviewHtml(server, request.url, response, 200, renderCompositionsPage(route.entry, previewRuntime));
      return;
    }

    const composition = route.entry.compositions.find((candidate) => candidate.id === route.compositionId);
    await sendPreviewHtml(
      server,
      request.url,
      response,
      composition && vendorConfig.mounter ? 200 : composition ? 500 : 404,
      !composition
        ? renderMessagePage("Composition not found", `${route.entry.component.id}/${route.compositionId}`)
        : vendorConfig.mounter
          ? renderCompositionPage(route.entry, composition, previewRuntime, vendorConfig.mounter)
          : renderMessagePage("Preview mounter missing", "This env preview config must define config.mounter.")
    );
  });
}

async function discoverPreviewEntries(components: ComponentRef[]) {
  const entries = await Promise.all(components.map(discoverComponentPreviewEntry));
  return entries.sort((left, right) => left.component.id.localeCompare(right.component.id));
}

async function discoverComponentPreviewEntry(component: ComponentRef): Promise<PreviewComponentEntry> {
  const dirEntries = await readdir(component.rootDir, { withFileTypes: true });
  const fileNames = dirEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const docsFile = fileNames.find((fileName) => fileName.endsWith(".docs.md") || fileName.endsWith(".docs.mdx"));
  const demoFiles = fileNames.filter((fileName) => readCompositionId(fileName) !== undefined);

  return {
    component,
    ...(docsFile ? { docs: await readDocsEntry(path.join(component.rootDir, docsFile), component.id) } : {}),
    compositions: await Promise.all(
      demoFiles.map((fileName) => readCompositionEntry(path.join(component.rootDir, fileName), fileName))
    ),
  };
}

async function readDocsEntry(filePath: string, componentId: string): Promise<PreviewDocsEntry> {
  const source = await readFile(filePath, "utf8");
  return { title: readDocsTitle(source) ?? componentId, source };
}

async function readCompositionEntry(filePath: string, fileName: string): Promise<PreviewCompositionEntry> {
  const id = readCompositionId(fileName);
  if (!id) throw new Error(`Invalid demo file name: ${fileName}`);
  return {
    id,
    title: readCompositionTitle(await readFile(filePath, "utf8")) ?? titleFromId(id),
    filePath,
  };
}

function matchPreviewRoute(
  url: string,
  basePath: string,
  entries: PreviewComponentEntry[]
): MatchedPreviewRoute | undefined {
  const pathname = new URL(url, "http://bit-lite-preview.local").pathname;
  const restCandidates = pathname.startsWith(basePath)
    ? [pathname.slice(basePath.length)]
    : [pathname.replace(/^\/+/, "")];

  for (const rest of restCandidates) {
    for (const entry of entries) {
      for (const prefix of [encodeURIComponent(entry.component.id), entry.component.id]) {
        const suffix = rest === prefix ? "" : rest.startsWith(`${prefix}/`) ? rest.slice(prefix.length + 1) : undefined;
        if (suffix === "docs") return { entry, kind: "docs" };
        if (suffix === "compositions") return { entry, kind: "compositions-list" };
        if (suffix?.startsWith("compositions/")) {
          try {
            return { entry, kind: "composition", compositionId: decodeURIComponent(suffix.slice("compositions/".length)) };
          } catch {
            return undefined;
          }
        }
      }
    }
  }

  return undefined;
}

async function sendPreviewHtml(
  server: ViteDevServer,
  url: string,
  response: { statusCode: number; setHeader(name: string, value: string): void; end(content: string): void },
  statusCode: number,
  html: string
) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(await server.transformIndexHtml(url, html));
}

function renderDocsPage(entry: PreviewComponentEntry, runtime: PreviewVendorRuntime) {
  const docs = entry.docs;
  const body = docs
    ? `<article class="docs">${renderMarkdown(docs.source)}</article>`
    : `<p class="empty">No docs file was found for this component.</p>`;
  const compositions = entry.compositions
    .map((composition) => `<li><a href="${compositionRoute(runtime, entry.component.id, composition.id)}">${escapeHtml(composition.title)}</a></li>`)
    .join("");
  return renderPage(docs?.title ?? entry.component.id, `${body}<aside><h2>Compositions</h2><ul>${compositions || "<li>No compositions found.</li>"}</ul></aside>`);
}

function renderCompositionsPage(entry: PreviewComponentEntry, runtime: PreviewVendorRuntime) {
  const items = entry.compositions
    .map((composition) => `<li><a href="${compositionRoute(runtime, entry.component.id, composition.id)}">${escapeHtml(composition.title)}</a><span>${escapeHtml(composition.id)}</span></li>`)
    .join("");
  return renderPage(
    `${entry.component.id} compositions`,
    `<p><a href="${componentRoute(runtime, entry.component.id)}/docs">Docs</a></p><ul class="composition-list">${items || "<li>No compositions found.</li>"}</ul>`
  );
}

function renderCompositionPage(
  entry: PreviewComponentEntry,
  composition: PreviewCompositionEntry,
  runtime: PreviewVendorRuntime,
  mounter: string
) {
  const context = JSON.stringify({ componentId: entry.component.id, compositionId: composition.id });
  return renderPage(
    `${composition.title} · ${entry.component.id}`,
    `<p><a href="${componentRoute(runtime, entry.component.id)}/compositions">All compositions</a></p>
<div id="preview-root" class="preview-root"></div>
<script type="module">
import * as compositionModule from ${JSON.stringify(toBrowserImportSpecifier(composition.filePath))};
import mountPreviewComposition from ${JSON.stringify(toBrowserImportSpecifier(mounter))};
const root = document.getElementById("preview-root");
const composition = compositionModule.default ?? compositionModule;
const cleanup = await mountPreviewComposition(composition, root, ${context});
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    if (typeof cleanup === "function") cleanup();
  });
}
</script>`
  );
}

function renderMessagePage(title: string, message: string) {
  return renderPage(title, `<p class="empty">${escapeHtml(message)}</p>`);
}

function renderPage(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#f8fafc;color:#111827;font-family:Inter,ui-sans-serif,system-ui,sans-serif}main{width:min(920px,calc(100vw - 32px));margin:0 auto;padding:32px 0 48px}h1{margin:0 0 18px;font-size:28px;line-height:1.12}h2{margin:24px 0 10px;font-size:18px}p{line-height:1.65}a{color:#0f766e;font-weight:650;text-decoration:none}a:hover{text-decoration:underline}code{background:#e5e7eb;border-radius:4px;padding:2px 4px}pre{overflow:auto;border:1px solid #d1d5db;border-radius:8px;background:#111827;color:#f9fafb;padding:14px}pre code{background:transparent;padding:0}article.docs{background:#fff;border:1px solid #d1d5db;border-radius:8px;padding:18px 20px}aside{margin-top:18px}.composition-list{display:grid;gap:10px;padding-left:20px}.composition-list span{margin-left:8px;color:#6b7280;font-size:13px}.preview-root{min-height:220px;border:1px solid #d1d5db;border-radius:8px;background:#fff;padding:20px}.empty{color:#6b7280}</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

function renderMarkdown(source: string) {
  const lines = stripFrontmatter(source).split(/\r?\n/);
  const html: string[] = [];
  let paragraph: string[] = [];
  let codeFence: string[] | undefined;
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (codeFence) {
        html.push(`<pre><code>${escapeHtml(codeFence.join("\n"))}</code></pre>`);
        codeFence = undefined;
      } else {
        flushParagraph();
        codeFence = [];
      }
      continue;
    }
    if (codeFence) {
      codeFence.push(line);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1]?.length ?? 1;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2] ?? "")}</h${level}>`);
      continue;
    }
    if (line.trim().length === 0) {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph();
  if (codeFence) html.push(`<pre><code>${escapeHtml(codeFence.join("\n"))}</code></pre>`);
  return html.join("\n");
}

function renderInlineMarkdown(value: string) {
  return escapeHtml(value).replace(/`([^`]+)`/g, "<code>$1</code>");
}

function readPreviewVendorConfig(config: Record<string, unknown>, workspaceRoot: string): PreviewVendorConfig {
  const configFile = config.configFile;
  if (typeof configFile !== "string" || configFile.length === 0) {
    throw new Error('preview vendor config must define a non-empty "configFile" string');
  }
  const mounter = config.mounter;
  const docsTemplate = config.docsTemplate;
  if (mounter !== undefined && typeof mounter !== "string") throw new Error('preview vendor config field "mounter" must be a string');
  if (docsTemplate !== undefined && typeof docsTemplate !== "string") throw new Error('preview vendor config field "docsTemplate" must be a string');
  return {
    configFile: resolveImportSpecifier(configFile, workspaceRoot),
    ...(mounter === undefined ? {} : { mounter: resolveImportSpecifier(mounter, workspaceRoot) }),
    ...(docsTemplate === undefined ? {} : { docsTemplate: resolveImportSpecifier(docsTemplate, workspaceRoot) }),
  };
}

function readPreviewRuntime(runtime: JsonObject | undefined): PreviewVendorRuntime {
  if (!isRecord(runtime)) throw new Error("preview vendor runtime is missing");
  const { host, port, basePath, proxyOrigin } = runtime;
  if (typeof host !== "string" || host.length === 0) throw new Error("preview vendor runtime.host is missing");
  if (typeof port !== "number" || !Number.isInteger(port)) throw new Error("preview vendor runtime.port is missing");
  if (typeof basePath !== "string" || !basePath.startsWith("/")) throw new Error("preview vendor runtime.basePath is missing");
  if (typeof proxyOrigin !== "string" || proxyOrigin.length === 0) throw new Error("preview vendor runtime.proxyOrigin is missing");
  return { host, port, basePath, proxyOrigin };
}

function createHmrOptions(runtime: PreviewVendorRuntime) {
  const proxy = new URL(runtime.proxyOrigin);
  return {
    host: proxy.hostname,
    clientPort: proxy.port ? Number(proxy.port) : proxy.protocol === "https:" ? 443 : 80,
    protocol: proxy.protocol === "https:" ? "wss" as const : "ws" as const,
  };
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

function readCompositionTitle(source: string) {
  return /export\s+const\s+title\s*=\s*["']([^"']+)["']/.exec(source)?.[1];
}

function titleFromId(id: string) {
  return id.split(/[-_\s]+/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function componentRoute(runtime: PreviewVendorRuntime, componentId: string) {
  return `${runtime.basePath}${encodeURIComponent(componentId)}`;
}

function compositionRoute(runtime: PreviewVendorRuntime, componentId: string, compositionId: string) {
  return `${componentRoute(runtime, componentId)}/compositions/${encodeURIComponent(compositionId)}`;
}

function toBrowserImportSpecifier(specifier: string) {
  if (path.isAbsolute(specifier)) return `/@fs${toPosixPath(specifier)}`;
  if (isFileUrl(specifier)) return `/@fs${toPosixPath(fileURLToPath(specifier))}`;
  return specifier;
}

function resolveImportSpecifier(specifier: string, workspaceRoot: string) {
  if (isFileUrl(specifier)) return fileURLToPath(specifier);
  if (isAbsoluteUrl(specifier)) return specifier;
  if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
    return path.isAbsolute(specifier) ? specifier : path.resolve(workspaceRoot, specifier);
  }
  for (const root of [workspaceRoot, process.cwd()]) {
    try {
      return createRequire(path.join(root, "package.json")).resolve(specifier);
    } catch {
      // Try the next resolution root.
    }
  }
  return pathToFileURL(specifier).href;
}

function isFileUrl(value: string) {
  try {
    return new URL(value).protocol === "file:";
  } catch {
    return false;
  }
}

function isAbsoluteUrl(value: string) {
  try {
    return new URL(value).protocol.length > 0;
  } catch {
    return false;
  }
}

function isShutdownMessage(message: unknown) {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "shutdown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return char;
    }
  });
}

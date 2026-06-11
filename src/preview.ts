import { readdir } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import path from "node:path";
import { fileHasKind, findFirstFileByKind } from "./file-matcher.js";
import { readVendorServiceConfig, unsupportedVendorResult } from "./service-config.js";
import { startTestWatchers } from "./test-command.js";
import { createServiceTask } from "./runtime.js";
import type { ComponentRef, ServiceFactory, WorkspaceRuntime } from "./types.js";
import type { PreviewFramework, PreviewVendorConfig } from "./services/preview/types.js";
import { vitePreviewVendor, viteServers } from "./services/preview/vendors/vite.js";
import { webpackPreviewVendor } from "./services/preview/vendors/webpack.js";

type PreviewServiceConfig = {
  vendor?: string;
  framework?: PreviewFramework;
  host?: string;
  centralHost?: string;
  strictPort?: boolean;
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

const previewVendors = {
  vite: vitePreviewVendor,
  webpack: webpackPreviewVendor,
};

let coordinator: PreviewCoordinator | undefined;
let nextEnvPort = DEFAULT_ENV_PORT;
let signalHandlersInstalled = false;
let testWatchController: AbortController | undefined;
type TestWatcherState = {
  envName: string;
  output: string;
  status: "idle" | "running" | "exited";
  exitCode?: number;
};
const testWatchers = new Map<string, TestWatcherState>();

export const createPreviewService: ServiceFactory = () => ({
  name: "preview",
  run(input, context) {
    return createServiceTask(async ({ emit }) => {
      const workspaceRoot = requireWorkspaceRoot(context);
      const envName = context?.envName ?? "unknown";
      rejectCliArgs(input.args, "preview");
      const serviceDefinition = readVendorServiceConfig(input.config, "vite");
      const serviceConfig = {
        ...readPreviewConfig(serviceDefinition.config),
        vendor: serviceDefinition.vendor,
      };
      const vendor = previewVendors[serviceConfig.vendor as keyof typeof previewVendors];
      if (!vendor) return unsupportedVendorResult("preview", serviceConfig.vendor);
      const framework = serviceConfig.framework ?? "html";
      const entries = await discoverPreviewEntries(input.components, envName, framework, serviceConfig);
      if (entries.length === 0) {
        return {
          ok: true,
          message: `preview found no preview files for ${envName}`,
        };
      }

      const central = await ensureCoordinator(serviceConfig);
      const port = nextPreviewPort();
      const host = serviceConfig.host ?? DEFAULT_HOST;
      const base = `/env/${encodeURIComponent(envName)}/`;
      const task = vendor.run(
        {
          ...input,
          config: {
            ...(serviceConfig as PreviewVendorConfig),
            framework,
            host,
          },
          entries,
          base,
          port,
          host,
        },
        context
      );
      const unsubscribe = task.listen((type, payload) => emit(type, payload));
      const result = await task.result.finally(unsubscribe);
      if (!result.ok) return result;
      const url = result.url ?? `http://${host}:${port}${base}`;
      central.envs.set(envName, {
        envName,
        framework,
        host,
        port,
        base,
        url,
        components: entries,
      });
      installSignalHandlers();
      emit("status", {
        status: "running",
        message: `preview ${envName} running at ${url}`,
      });

      return {
        ok: true,
        message: `preview ${envName} running at ${url}; central preview at ${central.url}`,
      };
    });
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

async function ensureCoordinator(config: PreviewServiceConfig): Promise<PreviewCoordinator> {
  if (coordinator) {
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
  return config;
}

function requireWorkspaceRoot(context: { workspaceRoot?: string } | undefined) {
  if (!context?.workspaceRoot) throw new Error("preview requires workspaceRoot in context");
  return context.workspaceRoot;
}

function rejectCliArgs(args: unknown, serviceName: string) {
  if (!Array.isArray(args) || args.length === 0) return;
  throw new Error(`service "${serviceName}" does not accept arguments: ${args.map(String).join(" ")}`);
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
      testWatchController?.abort();
    }
    await new Promise<void>((resolve) => coordinator?.server.close(() => resolve()) ?? resolve());
    console.log("start stopped");
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

export async function startTestWatchersForWorkspace(workspace: WorkspaceRuntime) {
  if (testWatchController) return;
  testWatchController = new AbortController();
  void startTestWatchers(workspace, {
    signal: testWatchController.signal,
    onEvent: (event) => {
      if (event.type === "start") {
        testWatchers.set(event.envName, {
          envName: event.envName,
          status: "running",
          output: `Starting tests for ${event.envName}...`,
        });
      } else if (event.type === "output") {
        appendTestOutput(ensureTestWatcherState(event.envName), event.chunk);
      } else if (event.type === "service-event" && event.eventType === "status" && isStatusPayload(event.payload)) {
        const state = ensureTestWatcherState(event.envName);
        if (event.payload.status === "running") state.status = "running";
        if (event.payload.status === "passed" || event.payload.status === "failed" || event.payload.status === "stopped") {
          state.status = "exited";
        }
      } else if (event.type === "exit") {
        const state = ensureTestWatcherState(event.envName);
        state.status = "exited";
        appendTestOutput(state, `\n${event.result.result.message ?? `Test watcher for ${event.envName} exited.`}\n`);
      } else if (event.type === "error") {
        const state = ensureTestWatcherState(event.envName);
        const message = event.error instanceof Error ? event.error.message : String(event.error);
        state.status = "exited";
        state.exitCode = 1;
        appendTestOutput(state, `\nTest watcher for ${event.envName} failed: ${message}\n`);
      }
    },
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    for (const group of workspace.groups) {
      const state = ensureTestWatcherState(group.envName);
      state.status = "exited";
      state.exitCode = 1;
      appendTestOutput(state, `\nTest watchers failed: ${message}\n`);
    }
  });
}

function isStatusPayload(value: unknown): value is { status: string } {
  return typeof value === "object" && value !== null && typeof (value as { status?: unknown }).status === "string";
}

function ensureTestWatcherState(envName: string) {
  let state = testWatchers.get(envName);
  if (!state) {
    state = {
      envName,
      status: "idle",
      output: "",
    };
    testWatchers.set(envName, state);
  }
  return state;
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


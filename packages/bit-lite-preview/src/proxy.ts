import { readFileSync } from "node:fs";
import {
  ProxyServer,
  encodeRouteSegment,
  findAvailablePort,
  proxyHttpRequest,
  proxyWebSocket,
  sendHtml,
  sendJson,
} from "bit-lite-proxy";
import { getSelectedEnvKey } from "bit-lite-context";
import type { SelectedEnvIdentity } from "bit-lite-context";
import type { ProxyEndpoint, ProxyRoute } from "bit-lite-proxy";
import type { PreparedPreviewComponent } from "./preparation.js";

const previewShellHtml = readFileSync(new URL("./assets/preview-shell.html", import.meta.url), "utf8");
const previewMessageTemplate = readFileSync(new URL("./assets/preview-message.html", import.meta.url), "utf8");

export { encodeRouteSegment, findAvailablePort } from "bit-lite-proxy";

export type PreviewServerInfo = {
  origin: string;
  host: string;
  port: number;
  basePath: string;
};

export type PreviewProxyComponent = {
  componentId: string;
  overviewRoute: string;
  docsRoute?: string;
  compositions: Array<{ id: string; exportName: string; name: string; route: string }>;
};

export type PreviewEnvState = {
  env: SelectedEnvIdentity;
  taskId: string;
  vendor: string;
  status: string;
  error?: string | undefined;
  server?: PreviewServerInfo | undefined;
  components: PreviewProxyComponent[];
};

export type PreviewProxyManifest = {
  proxy: ProxyEndpoint;
  envs: PreviewEnvState[];
};

export type PreviewProxyStateOptions = {
  envs: Array<{
    env: SelectedEnvIdentity;
    taskId: string;
    vendor: string;
    status: string;
    components: readonly { id: string }[];
  }>;
};

export class PreviewProxyState {
  #envs = new Map<string, PreviewEnvState>();

  constructor(options: PreviewProxyStateOptions) {
    for (const item of options.envs) {
      this.#envs.set(getSelectedEnvKey(item.env), {
        env: item.env,
        taskId: item.taskId,
        vendor: item.vendor,
        status: item.status,
        components: item.components.map((component) => ({
          componentId: component.id,
          overviewRoute: `/env/${encodeRouteSegment(item.env.packageName)}/#${encodeRouteSegment(component.id)}`,
          compositions: [],
        })),
      });
    }
  }

  updateTask(envIdentity: SelectedEnvIdentity, updates: Partial<Pick<PreviewEnvState, "taskId" | "vendor" | "status">>) {
    const env = this.#envs.get(getSelectedEnvKey(envIdentity));
    if (env) Object.assign(env, updates);
  }

  updateServer(envIdentity: SelectedEnvIdentity, server: PreviewServerInfo, vendor: string) {
    const env = this.#envs.get(getSelectedEnvKey(envIdentity));
    if (!env) return;
    env.status = "ready";
    env.vendor = vendor;
    env.server = server;
  }

  updatePreparedComponents(envIdentity: SelectedEnvIdentity, basePath: string, components: PreparedPreviewComponent[]) {
    const env = this.#envs.get(getSelectedEnvKey(envIdentity));
    if (!env) return;
    env.components = components.map((component) => createProxyComponent(basePath, component));
  }

  updatePreparationFailure(envIdentity: SelectedEnvIdentity, error: unknown) {
    const env = this.#envs.get(getSelectedEnvKey(envIdentity));
    if (!env) return;
    env.status = "failed";
    env.error = formatError(error);
    env.server = undefined;
  }

  envs() {
    return Array.from(this.#envs.values()).sort((left, right) =>
      getSelectedEnvKey(left.env).localeCompare(getSelectedEnvKey(right.env))
    );
  }

  findEnvByPackageName(packageName: string) {
    return this.envs().find((env) => env.env.packageName === packageName);
  }

  manifest(proxy: ProxyEndpoint): PreviewProxyManifest {
    return { proxy, envs: this.envs() };
  }
}

export function createPreviewServiceRoutes(state: PreviewProxyState): ProxyRoute[] {
  return [
    {
      id: "preview-envs",
      matches(url) {
        const packageName = readEnvPackageName(url.pathname);
        return packageName !== undefined && state.findEnvByPackageName(packageName) !== undefined;
      },
      async handleHttp(request, response, context) {
        const packageName = readEnvPackageName(context.url.pathname);
        const env = packageName === undefined ? undefined : state.findEnvByPackageName(packageName);
        if (!env) {
          sendHtml(response, 404, renderMessagePage("Not found", "This preview route is not registered."));
          return;
        }
        if (!env.server) {
          response.setHeader("Retry-After", "1");
          sendHtml(
            response,
            503,
            renderMessagePage(
              env.status === "failed" ? "Preview preparation failed" : "Preview is starting",
              env.error ?? `${env.env.packageName} is ${env.status}.`
            )
          );
          return;
        }

        try {
          await proxyHttpRequest(request, response, env.server);
        } catch (error) {
          if (!response.headersSent) {
            sendHtml(response, 502, renderMessagePage("Preview proxy failed", formatError(error)));
          } else {
            response.destroy(error instanceof Error ? error : undefined);
          }
        }
      },
      handleUpgrade(request, socket, head, context) {
        const packageName = readEnvPackageName(context.url.pathname);
        const env = packageName === undefined ? undefined : state.findEnvByPackageName(packageName);
        if (!env?.server) {
          socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        proxyWebSocket(request, socket, head, env.server);
      },
    },
  ];
}

export function createPreviewPresentationRoutes(state: PreviewProxyState): ProxyRoute[] {
  return [
    {
      id: "preview-root",
      matches: (url) => url.pathname === "/",
      handleHttp(_request, response) {
        sendHtml(response, 200, previewShellHtml);
      },
    },
    {
      id: "preview-manifest",
      matches: (url) => url.pathname === "/__bit-lite/manifest.json",
      handleHttp(_request, response, context) {
        sendJson(response, state.manifest(context.endpoint));
      },
    },
  ];
}

export class PreviewProxyServer {
  #proxy = new ProxyServer();
  #state: PreviewProxyState;

  constructor(options: PreviewProxyStateOptions) {
    this.#state = new PreviewProxyState(options);
    this.#proxy.addRoutes([
      ...createPreviewPresentationRoutes(this.#state),
      ...createPreviewServiceRoutes(this.#state),
    ]);
  }

  get origin() {
    return this.#proxy.origin;
  }

  get state() {
    return this.#state;
  }

  start(host: string, preferredPort: number) {
    return this.#proxy.start(host, preferredPort);
  }

  close() {
    return this.#proxy.close();
  }

  updateTask(envIdentity: SelectedEnvIdentity, updates: Partial<Pick<PreviewEnvState, "taskId" | "vendor" | "status">>) {
    this.#state.updateTask(envIdentity, updates);
  }

  updateServer(envIdentity: SelectedEnvIdentity, server: PreviewServerInfo, vendor: string) {
    this.#state.updateServer(envIdentity, server, vendor);
  }

  updatePreparedComponents(envIdentity: SelectedEnvIdentity, basePath: string, components: PreparedPreviewComponent[]) {
    this.#state.updatePreparedComponents(envIdentity, basePath, components);
  }

  updatePreparationFailure(envIdentity: SelectedEnvIdentity, error: unknown) {
    this.#state.updatePreparationFailure(envIdentity, error);
  }

  manifest() {
    return this.#state.manifest(this.#proxy.endpoint);
  }
}

function createProxyComponent(basePath: string, component: PreparedPreviewComponent): PreviewProxyComponent {
  return {
    componentId: component.component.id,
    overviewRoute: `${basePath}${createHashRoute(component.component.id)}`,
    ...(component.docs ? { docsRoute: `${basePath}${component.docs.route}` } : {}),
    compositions: component.compositions.map((composition) => ({
      id: composition.id,
      exportName: composition.exportName,
      name: composition.name,
      route: `${basePath}${composition.route}`,
    })),
  };
}

function createHashRoute(componentId: string) {
  return `#${encodeURIComponent(componentId)}`;
}

function readEnvPackageName(pathname: string) {
  const parts = pathname.split("/");
  if (parts[1] !== "env" || !parts[2]) return undefined;
  try {
    return decodeURIComponent(parts[2]);
  } catch {
    return undefined;
  }
}

function renderMessagePage(title: string, message: string) {
  return previewMessageTemplate
    .replaceAll("{{TITLE}}", escapeHtml(title))
    .replace("{{MESSAGE}}", escapeHtml(message));
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

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

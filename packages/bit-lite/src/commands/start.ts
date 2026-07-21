import { readFileSync } from "node:fs";
import { getSelectedEnvKey } from "bit-lite-context";
import { ProxyServer, sendHtml, sendJson, sendText } from "bit-lite-proxy";
import { stopVendorTasks, superviseVendorTasks } from "bit-lite-vendors";
import type { CliOptionValue, ParsedCliArgs, SelectedEnvIdentity } from "bit-lite-context";
import type { ProxyEndpoint, ProxyRoute } from "bit-lite-proxy";
import type { PreviewProxyComponent, PreviewProxyManifest } from "bit-lite-preview/node";
import type { VendorTask } from "bit-lite-vendors";
import { BitLiteError } from "../utils/errors.js";
import { prepareResolvedCommandSelection } from "../utils/command-selection.js";
import type { ResolvedCommandSelection } from "../utils/command-selection.js";
import {
  createPreviewCommandContribution,
  readPreviewLazy,
  type PreviewCommandContribution,
  type PreviewUnavailableGroup,
} from "./preview.js";
import {
  createStartSourceCatalog,
  createStartSourceRoute,
  createStartSourceRoutes,
  type StartSourceCatalog,
} from "./start-source.js";
import { createTestWatchContribution, type TestWatchContribution } from "./test.js";

const startShellHtml = readFileSync(new URL("../assets/start-shell.html", import.meta.url), "utf8");
const defaultHost = "127.0.0.1";
const defaultPort = 4000;

export type StartManifestComponent = {
  componentId: string;
  env: SelectedEnvIdentity;
  source: {
    route: string;
  };
  preview?: PreviewProxyComponent | undefined;
  test?: {
    taskId: string;
    vendor: string;
    status: string;
    route: string;
  } | undefined;
};

export type StartManifest = {
  proxy: ProxyEndpoint;
  preview: PreviewProxyManifest & {
    unavailable: PreviewUnavailableGroup[];
  };
  tests: Array<{
    taskId: string;
    env: SelectedEnvIdentity;
    vendor: string;
    status: string;
    componentIds: string[];
  }>;
  components: StartManifestComponent[];
};

export async function runStartCommand(parsed: ParsedCliArgs) {
  const selection = await prepareResolvedCommandSelection(parsed);
  if (!hasConfiguredStartService(selection)) {
    printNoStartTasks(selection);
    return;
  }

  const host = readHost(parsed.args.options.host);
  const port = readPort(parsed.args.options.port, "--port", defaultPort);
  const activationMode = readPreviewLazy(parsed.args.options.lazy) ? "lazy" : "eager";
  const proxyServer = new ProxyServer();
  const sourceCatalog = createStartSourceCatalog(selection.components);
  let preview: PreviewCommandContribution | undefined;
  let test: TestWatchContribution | undefined;
  let resourcesDisposed = false;
  let supervisionHandedOff = false;

  const disposeResources = async () => {
    if (resourcesDisposed) return;
    resourcesDisposed = true;
    await test?.dispose();
    await preview?.dispose();
    await proxyServer.close();
  };

  try {
    const endpoint = await proxyServer.start(host, port);
    preview = await createPreviewCommandContribution(selection, { proxy: endpoint, host, activationMode });
    test = await createTestWatchContribution(selection);

    proxyServer.addRoutes(createStartRoutes(endpoint, preview, test, sourceCatalog));
    proxyServer.addRoutes(preview.routes);
    proxyServer.addRoutes(test.routes);

    const tasks = [...preview.tasks, ...test.tasks] as VendorTask[];
    if (tasks.length === 0) {
      printNoStartTasks(selection, preview);
      return;
    }

    console.log(`Start: ${endpoint.origin}`);
    await superviseVendorTasks(tasks, {
      title: () => `Start: ${endpoint.origin}`,
      formatStoppingMessage: (reason) => `Stopping bit-lite start (${reason})...\n`,
      onTasksStarted() {
        supervisionHandedOff = true;
        return disposeResources;
      },
    });
  } finally {
    if (!supervisionHandedOff) {
      const tasks = [...(preview?.tasks ?? []), ...(test?.tasks ?? [])] as VendorTask[];
      await stopVendorTasks(tasks);
    }
    await disposeResources();
  }
}

export function createStartManifest(
  proxy: ProxyEndpoint,
  preview: PreviewCommandContribution,
  test: TestWatchContribution
): StartManifest {
  const previewManifest = preview.manifest();
  const components = new Map<string, StartManifestComponent>();
  const ensureComponent = (componentId: string, env: SelectedEnvIdentity) => {
    const key = JSON.stringify([componentId, getSelectedEnvKey(env)]);
    let component = components.get(key);
    if (!component) {
      component = { componentId, env, source: { route: createStartSourceRoute(componentId) } };
      components.set(key, component);
    }
    return component;
  };

  for (const group of preview.groups) {
    for (const component of group.components) ensureComponent(component.id, group.env.env);
  }
  for (const env of previewManifest.envs) {
    for (const previewComponent of env.components) {
      ensureComponent(previewComponent.componentId, env.env).preview = previewComponent;
    }
  }
  for (const binding of test.bindings) {
    for (const componentId of binding.componentIds) {
      ensureComponent(componentId, binding.task.context.env).test = {
        taskId: binding.task.id,
        vendor: binding.task.vendor.id,
        status: binding.task.status,
        route: `/tests?component=${encodeURIComponent(componentId)}`,
      };
    }
  }

  return {
    proxy,
    preview: {
      ...previewManifest,
      unavailable: preview.unavailable.map((item) => ({
        env: item.env,
        reason: item.reason,
        componentIds: [...item.componentIds],
      })),
    },
    tests: test.bindings.map((binding) => ({
      taskId: binding.task.id,
      env: binding.task.context.env,
      vendor: binding.task.vendor.id,
      status: binding.task.status,
      componentIds: [...binding.componentIds],
    })),
    components: Array.from(components.values()).sort(
      (left, right) => getSelectedEnvKey(left.env).localeCompare(getSelectedEnvKey(right.env)) ||
        left.componentId.localeCompare(right.componentId)
    ),
  };
}

export function createStartRoutes(
  proxy: ProxyEndpoint,
  preview: PreviewCommandContribution,
  test: TestWatchContribution,
  sourceCatalog: StartSourceCatalog
): ProxyRoute[] {
  return [
    {
      id: "start:shell",
      matches: (url) => url.pathname === "/",
      handleHttp(request, response) {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          sendText(response, 405, "Method not allowed");
          return;
        }
        sendHtml(response, 200, startShellHtml);
      },
    },
    {
      id: "start:manifest",
      matches: (url) => url.pathname === "/__bit-lite/manifest.json",
      handleHttp(request, response) {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          sendText(response, 405, "Method not allowed");
          return;
        }
        sendJson(response, createStartManifest(proxy, preview, test));
      },
    },
    ...createStartSourceRoutes(sourceCatalog),
  ];
}

function hasConfiguredStartService(selection: ResolvedCommandSelection) {
  return selection.groups.some((group) =>
    group.env.services.preview !== undefined || group.env.services.test !== undefined
  );
}

function printNoStartTasks(
  selection: ResolvedCommandSelection,
  preview?: PreviewCommandContribution
) {
  console.log("No start tasks found.");
  if (selection.groups.length === 0) {
    console.log("No components were selected from this workspace.");
    return;
  }
  console.log(`Selected envs: ${selection.groups.map((group) => group.env.env.packageName).join(", ")}`);
  if (preview && preview.preparationFailures.length > 0) {
    const failures = preview.preparationFailures
      .map(({ env, error }) => `${env.env.packageName}: ${formatError(error)}`)
      .join("; ");
    console.log(`Preview preparation failures: ${failures}`);
  }
  console.log("Make sure selected envs define services.preview or services.test in their env packages.");
}

function readHost(value: CliOptionValue | undefined) {
  if (value === undefined) return defaultHost;
  if (typeof value !== "string" || value.length === 0) throw new BitLiteError("--host requires a host name");
  return value;
}

function readPort(value: CliOptionValue | undefined, optionName: string, fallback: number) {
  if (value === undefined) return fallback;
  const port = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BitLiteError(`${optionName} requires a port number between 1 and 65535`);
  }
  return port;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

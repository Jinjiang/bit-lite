import { readFileSync } from "node:fs";
import { getSelectedEnvKey } from "bit-lite-context";
import { ProxyServer, sendHtml, sendJson, sendText } from "bit-lite-proxy";
import { superviseVendorTasks } from "bit-lite-vendors";
import type { CliOptionValue, ParsedCliArgs, SelectedEnvIdentity } from "bit-lite-context";
import type { ProxyEndpoint, ProxyRoute } from "bit-lite-proxy";
import type { PreviewProxyComponent, PreviewProxyManifest } from "bit-lite-preview/node";
import type { VendorTask } from "bit-lite-vendors";
import { BitLiteError } from "../utils/errors.js";
import { prepareResolvedCommandSelection } from "../utils/command-selection.js";
import type { ResolvedCommandSelection } from "../utils/command-selection.js";
import {
  createCompileWatchContribution,
  selectCompileRootIds,
  type CompileWatchContribution,
} from "./compile.js";
import {
  createPreviewCommandContribution,
  readPreviewLazy,
  type PreviewCommandContribution,
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
  compile?: {
    taskId: string;
    vendor: string;
    status: string;
  } | undefined;
  test?: {
    taskId: string;
    vendor: string;
    status: string;
    route: string;
  } | undefined;
};

export type StartManifest = {
  proxy: ProxyEndpoint;
  compiles: Array<{
    taskId: string;
    componentId: string;
    env: SelectedEnvIdentity;
    vendor: string;
    status: string;
  }>;
  preview: PreviewProxyManifest;
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
  const compileRootIds = selectCompileRootIds(selection);
  if (!hasConfiguredStartService(selection, compileRootIds)) {
    printNoStartTasks(selection);
    return;
  }

  const host = readHost(parsed.args.options.host);
  const port = readPort(parsed.args.options.port, "--port", defaultPort);
  const activationMode = readPreviewLazy(parsed.args.options.lazy) ? "lazy" : "eager";
  const proxyServer = new ProxyServer();
  const sourceCatalog = createStartSourceCatalog(selection.components);
  let compile: CompileWatchContribution | undefined;
  let preview: PreviewCommandContribution | undefined;
  let test: TestWatchContribution | undefined;
  let proxyStarted = false;
  let disposePromise: Promise<void> | undefined;

  const disposeResources = () => {
    if (disposePromise) return disposePromise;
    disposePromise = (async () => {
      const failures: unknown[] = [];
      try {
        await test?.dispose();
      } catch (error) {
        failures.push(error);
      }
      try {
        await preview?.dispose();
      } catch (error) {
        failures.push(error);
      }
      if (compile) {
        try {
          await compile.dispose();
        } catch (error) {
          failures.push(error);
        }
      }
      if (proxyStarted) {
        try {
          await proxyServer.close();
        } catch (error) {
          failures.push(error);
        }
      }
      throwCombinedErrors(failures, "Failed to dispose bit-lite start");
    })();
    return disposePromise;
  };

  const failures: unknown[] = [];
  try {
    compile = await createCompileWatchContribution(
      selection.context.workspace,
      compileRootIds,
      selection.parsed.args
    );
    await compile.ready();

    const endpoint = await proxyServer.start(host, port);
    proxyStarted = true;
    preview = await createPreviewCommandContribution(selection, { proxy: endpoint, host, activationMode });
    test = await createTestWatchContribution(selection);

    proxyServer.addRoutes(createStartRoutes(
      endpoint,
      preview,
      test,
      sourceCatalog,
      { selection, compile }
    ));
    proxyServer.addRoutes(preview.routes);
    proxyServer.addRoutes(test.routes);

    const tasks = [...compile.tasks, ...preview.tasks, ...test.tasks] as VendorTask[];
    if (tasks.length === 0) {
      printNoStartTasks(selection, preview);
    } else {
      console.log(`Start: ${endpoint.origin}`);
      await superviseVendorTasks(tasks, {
        title: () => `Start: ${endpoint.origin}`,
        dispose: disposeResources,
      });
    }
  } catch (error) {
    failures.push(error);
  }
  try {
    await disposeResources();
  } catch (error) {
    if (!failures.includes(error)) failures.push(error);
  }
  throwCombinedErrors(failures, "bit-lite start failed and cleanup also failed");
}

function throwCombinedErrors(errors: unknown[], message: string): void {
  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length === 0) return;
  if (uniqueErrors.length === 1) throw uniqueErrors[0];
  throw new AggregateError(uniqueErrors, message);
}

export function createStartManifest(
  proxy: ProxyEndpoint,
  preview: PreviewCommandContribution,
  test: TestWatchContribution,
  options?: {
    selection: ResolvedCommandSelection;
    compile: CompileWatchContribution;
  }
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

  for (const group of options?.selection.groups ?? preview.groups) {
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
  for (const binding of options?.compile.bindings ?? []) {
    const selected = options?.selection.components.some(
      (component) => component.id === binding.component.id
    );
    if (selected) {
      ensureComponent(binding.component.id, binding.task.context.env).compile = {
        taskId: binding.task.id,
        vendor: binding.task.vendor.id,
        status: binding.task.status,
      };
    }
  }

  return {
    proxy,
    compiles: (options?.compile.bindings ?? []).map((binding) => ({
      taskId: binding.task.id,
      componentId: binding.component.id,
      env: binding.task.context.env,
      vendor: binding.task.vendor.id,
      status: binding.task.status,
    })),
    preview: previewManifest,
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
  sourceCatalog: StartSourceCatalog,
  options?: {
    selection: ResolvedCommandSelection;
    compile: CompileWatchContribution;
  }
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
        sendJson(response, createStartManifest(proxy, preview, test, options));
      },
    },
    ...createStartSourceRoutes(sourceCatalog),
  ];
}

function hasConfiguredStartService(
  selection: ResolvedCommandSelection,
  compileRootIds: readonly string[]
) {
  return compileRootIds.length > 0 || selection.groups.some((group) =>
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
  console.log(
    "Make sure selected components define services.compile or their envs define services.preview or services.test."
  );
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

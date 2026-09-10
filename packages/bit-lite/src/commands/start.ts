import { readFileSync } from "node:fs";
import { getSelectedEnvKey } from "bit-lite-env-resolution";
import { getOnly, ProxyServer, sendHtml, sendJson } from "bit-lite-proxy";
import { formatError } from "bit-lite-utils";
import { superviseVendorTasks } from "bit-lite-vendors";
import type { ParsedCliArgs } from "../cli/arg-types.js";
import type { SelectedEnvIdentity } from "bit-lite-env-resolution";
import type { ProxyEndpoint, ProxyRoute } from "bit-lite-proxy";
import type { PreviewProxyComponent, PreviewProxyManifest } from "bit-lite-preview/node";
import type { VendorTask } from "bit-lite-vendors";
import { prepareResolvedCommandSelection } from "./selection.js";
import { readHostOption, readPortOption } from "../cli/options.js";
import { disposeAll, once, runThenDispose } from "../session/disposal.js";
import type { ResolvedCommandSelection } from "./selection.js";
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

  const host = readHostOption(parsed.args.options.host);
  const port = readPortOption(parsed.args.options.port);
  const activationMode = readPreviewLazy(parsed.args.options.lazy) ? "lazy" : "eager";
  const proxyServer = new ProxyServer();
  const sourceCatalog = createStartSourceCatalog(selection.components);
  let compile: CompileWatchContribution | undefined;
  let preview: PreviewCommandContribution | undefined;
  let test: TestWatchContribution | undefined;
  let proxyStarted = false;

  // Released in the reverse of the order they were created, so no layer is torn
  // down while something built on top of it is still running.
  const disposeResources = once(() =>
    disposeAll("Failed to dispose bit-lite start", [
      () => test?.dispose(),
      () => preview?.dispose(),
      () => compile?.dispose(),
      () => (proxyStarted ? proxyServer.close() : undefined),
    ])
  );

  await runThenDispose(
    "bit-lite start failed and cleanup also failed",
    async () => {
      // Compile is readied before anything is served, so the first request
      // reaches components that have already been built once.
      compile = await createCompileWatchContribution(
        selection.context.workspace,
        compileRootIds,
        selection.parsed.args
      );
      await compile.ready();

      const endpoint = await proxyServer.start(host, port);
      proxyStarted = true;
      preview = await createPreviewCommandContribution(selection, {
        proxy: endpoint,
        host,
        activationMode,
      });
      test = await createTestWatchContribution(selection);

      proxyServer.addRoutes(
        createStartRoutes(endpoint, preview, test, sourceCatalog, { selection, compile })
      );
      proxyServer.addRoutes(preview.routes);
      proxyServer.addRoutes(test.routes);

      const tasks = [...compile.tasks, ...preview.tasks, ...test.tasks] as VendorTask[];
      if (tasks.length === 0) {
        printNoStartTasks(selection, preview);
        return;
      }

      console.log(`Start: ${endpoint.origin}`);
      await superviseVendorTasks(tasks, {
        title: () => `Start: ${endpoint.origin}`,
        dispose: disposeResources,
      });
    },
    disposeResources
  );
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
    for (const component of group.components) ensureComponent(component.id, group.env.identity);
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
      handleHttp: getOnly((_request, response) => {
        sendHtml(response, 200, startShellHtml);
      }),
    },
    {
      id: "start:manifest",
      matches: (url) => url.pathname === "/__bit-lite/manifest.json",
      handleHttp: getOnly((_request, response) => {
        sendJson(response, createStartManifest(proxy, preview, test, options));
      }),
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
  console.log(`Selected envs: ${selection.groups.map((group) => group.env.identity.packageName).join(", ")}`);
  if (preview && preview.preparationFailures.length > 0) {
    const failures = preview.preparationFailures
      .map(({ env, error }) => `${env.identity.packageName}: ${formatError(error)}`)
      .join("; ");
    console.log(`Preview preparation failures: ${failures}`);
  }
  console.log(
    "Make sure selected components define services.compile or their envs define services.preview or services.test."
  );
}

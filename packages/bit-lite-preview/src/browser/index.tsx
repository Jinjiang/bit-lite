import { Component, createElement, type ErrorInfo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  formatCompositionRoute,
  formatDocsRoute,
  formatOverviewRoute,
  parsePreviewHash,
  type PreviewHashRoute,
} from "../routes.js";
import type {
  PreviewBrowserComponent,
  PreviewDocsTemplateProps,
  PreviewOverviewProps,
  PreviewRuntimeController,
  StartPreviewOptions,
} from "../types.js";

export {
  formatCompositionRoute,
  formatDocsRoute,
  formatOverviewRoute,
  parsePreviewHash,
};
export type { PreviewHashRoute } from "../routes.js";
export type {
  PreviewBrowserComponent,
  PreviewBrowserComposition,
  PreviewBrowserDocs,
  PreviewComponentManifest,
  PreviewComposition,
  PreviewDocsModule,
  PreviewDocsTemplate,
  PreviewDocsTemplateProps,
  PreviewMounter,
  PreviewMounterCleanup,
  PreviewMounterContext,
  PreviewOverviewProps,
  PreviewOverviewRenderer,
  PreviewRuntimeController,
  StartPreviewOptions,
} from "../types.js";

export function startPreview(options: StartPreviewOptions): PreviewRuntimeController {
  const rootElement = document.getElementById("preview-root");
  if (!rootElement) throw new Error('preview browser entry requires an element with id "preview-root"');
  const container: HTMLElement = rootElement;

  let activeReactRoot: Root | undefined;
  let activeCompositionHost: HTMLElement | undefined;
  let activeCompositionCleanup: (() => void | Promise<void>) | undefined;
  let requestedVersion = 0;
  let stopped = false;
  let queue = Promise.resolve();

  const refresh = () => {
    if (stopped) return Promise.resolve();
    const version = ++requestedVersion;
    const task = queue.then(() => renderVersion(version));
    const handled = task.catch(async (error: unknown) => {
      if (!stopped && version === requestedVersion) {
        await disposeSurface().catch(() => undefined);
        renderReact(renderState("error", "Preview failed", formatError(error)));
      }
    });
    queue = handled;
    return handled;
  };

  const handleHashChange = () => {
    void refresh();
  };
  window.addEventListener("hashchange", handleHashChange);
  void refresh();

  return {
    refresh,
    async stop() {
      if (stopped) return queue;
      stopped = true;
      requestedVersion += 1;
      window.removeEventListener("hashchange", handleHashChange);
      const task = queue.then(disposeSurface);
      queue = task.catch(() => undefined);
      return task;
    },
  };

  async function renderVersion(version: number) {
    await disposeSurface();
    if (stopped || version !== requestedVersion) return;

    const route = parsePreviewHash(window.location.hash);
    if (route.kind === "invalid") {
      renderReact(renderState("invalid-route", "Invalid preview route", route.reason));
      return;
    }

    const entry = options.components.find((candidate) => candidate.component.id === route.componentId);
    if (!entry) {
      renderReact(renderState("not-found", "Component not found", route.componentId));
      return;
    }

    switch (route.kind) {
      case "overview":
        renderOverview(entry);
        return;
      case "docs":
        await renderDocs(entry, version);
        return;
      case "composition":
        await renderComposition(entry, route, version);
        return;
    }
  }

  function renderOverview(entry: PreviewBrowserComponent) {
    const props: PreviewOverviewProps = {
      component: entry.component,
      ...(entry.docs
        ? {
            docs: {
              ...(entry.docs.title === undefined ? {} : { title: entry.docs.title }),
              route: entry.docs.route,
            },
          }
        : {}),
      compositions: entry.compositions.map(({ id, exportName, name, route }) => ({ id, exportName, name, route })),
    };
    renderReact((options.renderOverview ?? renderDefaultOverview)(props));
  }

  async function renderDocs(entry: PreviewBrowserComponent, version: number) {
    if (!entry.docs) {
      renderReact(renderState("empty-docs", "No documentation", `No docs file was found for ${entry.component.id}.`));
      return;
    }

    renderReact(renderState("loading", "Loading documentation", entry.component.id));
    const docs = await entry.docs.load();
    if (stopped || version !== requestedVersion) return;
    await disposeSurface();
    if (stopped || version !== requestedVersion) return;
    const DocsTemplate = options.docsTemplate ?? DefaultDocsTemplate;
    renderReact(createElement(DocsTemplate, { docs }));
  }

  async function renderComposition(
    entry: PreviewBrowserComponent,
    route: Extract<PreviewHashRoute, { kind: "composition" }>,
    version: number
  ) {
    const composition = entry.compositions.find((candidate) => candidate.id === route.compositionId);
    if (!composition) {
      renderReact(renderState("not-found", "Demo not found", `${entry.component.id}/${route.compositionId}`));
      return;
    }
    if (!options.mounter) {
      renderReact(
        renderState(
          "missing-mounter",
          "Preview mounter missing",
          `${composition.name} cannot be rendered because this preview invocation did not provide a mounter.`
        )
      );
      return;
    }

    renderReact(renderState("loading", "Loading demo", composition.name));
    const compositionValue = await composition.load();
    if (stopped || version !== requestedVersion) return;
    await disposeSurface();
    if (stopped || version !== requestedVersion) return;

    const host = document.createElement("div");
    host.dataset.previewCompositionHost = "";
    container.replaceChildren(host);
    activeCompositionHost = host;
    const cleanup = await options.mounter(compositionValue, host, {
      componentId: entry.component.id,
      compositionId: composition.id,
    });

    if (stopped || version !== requestedVersion) {
      if (typeof cleanup === "function") await cleanup();
      if (activeCompositionHost === host) activeCompositionHost = undefined;
      host.remove();
      return;
    }
    activeCompositionCleanup = typeof cleanup === "function" ? cleanup : undefined;
  }

  function renderReact(node: ReactNode) {
    const root = createRoot(container);
    activeReactRoot = root;
    root.render(createElement(PreviewErrorBoundary, undefined, node));
  }

  async function disposeSurface() {
    const cleanup = activeCompositionCleanup;
    const compositionHost = activeCompositionHost;
    const reactRoot = activeReactRoot;
    activeCompositionCleanup = undefined;
    activeCompositionHost = undefined;
    activeReactRoot = undefined;

    let cleanupError: unknown;
    try {
      await cleanup?.();
    } catch (error) {
      cleanupError = error;
    } finally {
      compositionHost?.remove();
      reactRoot?.unmount();
      container.replaceChildren();
    }
    if (cleanupError !== undefined) throw cleanupError;
  }
}

export function renderDefaultOverview(props: PreviewOverviewProps): ReactNode {
  const demoItems = props.compositions.map((composition) =>
    createElement(
      "li",
      { key: composition.id },
      createElement("a", { href: composition.route }, composition.name)
    )
  );
  return createElement(
    "main",
    { "data-preview-state": "overview" },
    createElement("h1", undefined, props.component.id),
    props.docs ? createElement("p", undefined, createElement("a", { href: props.docs.route }, props.docs.title ?? "Docs")) : null,
    createElement("h2", undefined, "Demos"),
    demoItems.length > 0
      ? createElement("ul", undefined, demoItems)
      : createElement("p", undefined, "No demos found.")
  );
}

export function DefaultDocsTemplate({ docs }: PreviewDocsTemplateProps): ReactNode {
  const Content = docs.default;
  return createElement("main", { "data-preview-state": "docs" }, createElement(Content));
}

type PreviewErrorBoundaryProps = { children?: ReactNode };
type PreviewErrorBoundaryState = { error: string | undefined };

class PreviewErrorBoundary extends Component<PreviewErrorBoundaryProps, PreviewErrorBoundaryState> {
  state: PreviewErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: unknown): PreviewErrorBoundaryState {
    return { error: formatError(error) };
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo) {
    // React reports render details to the browser console in development.
  }

  render() {
    if (this.state.error) return renderState("error", "Preview render failed", this.state.error);
    return this.props.children;
  }
}

function renderState(kind: string, title: string, detail: string) {
  return createElement(
    "main",
    { "data-preview-state": kind },
    createElement("h1", undefined, title),
    createElement("p", undefined, detail)
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

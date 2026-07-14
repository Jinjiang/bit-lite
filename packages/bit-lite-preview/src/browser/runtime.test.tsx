// @vitest-environment jsdom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPreview } from "./index.js";
import type {
  PreviewBrowserComponent,
  PreviewBrowserComposition,
  PreviewBrowserDocs,
  PreviewRuntimeController,
} from "../types.js";

describe("preview browser runtime", () => {
  let controller: PreviewRuntimeController | undefined;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="preview-root"></div>';
    window.history.replaceState(null, "", "/");
  });

  afterEach(async () => {
    if (controller) await act(() => controller?.stop());
    controller = undefined;
    vi.restoreAllMocks();
  });

  it("starts with all renderers omitted and keeps content lazy on overview", async () => {
    const docsLoad = vi.fn(async () => ({ default: () => createElement("p", undefined, "Docs") }));
    const demoLoad = vi.fn(async () => ({ default: () => "demo" }));
    window.history.replaceState(null, "", "/#ui%2Fbutton");

    await act(async () => {
      controller = startPreview({ components: [component({ docsLoad, demoLoad })] });
      await controller.refresh();
    });

    expect(document.querySelector('[data-preview-state="overview"]')?.textContent).toContain("primary");
    expect(docsLoad).not.toHaveBeenCalled();
    expect(demoLoad).not.toHaveBeenCalled();
  });

  it("uses the default docs template and passes only the loaded module", async () => {
    const docsLoad = vi.fn(async () => ({ default: () => createElement("p", undefined, "Compiled docs") }));
    window.history.replaceState(null, "", "/#ui%2Fbutton?preview=docs");

    await act(async () => {
      controller = startPreview({ components: [component({ docsLoad })] });
      await controller.refresh();
    });

    expect(docsLoad).toHaveBeenCalled();
    expect(document.querySelector('[data-preview-state="docs"]')?.textContent).toContain("Compiled docs");
  });

  it("calls a custom overview renderer with descriptors but no load functions", async () => {
    const renderOverview = vi.fn((props) => createElement("p", { "data-custom-overview": "" }, props.component.id));
    window.history.replaceState(null, "", "/#ui%2Fbutton");

    await act(async () => {
      controller = startPreview({ components: [component({})], renderOverview });
      await controller.refresh();
    });

    const props = renderOverview.mock.calls.at(-1)?.[0];
    expect(document.querySelector("[data-custom-overview]")?.textContent).toBe("ui/button");
    expect(props?.docs).toEqual({ title: "Button", route: "#ui%2Fbutton?preview=docs" });
    expect(props?.compositions).toEqual([
      { id: "primary", route: "#ui%2Fbutton?preview=compositions&name=primary" },
    ]);
    expect(props?.docs).not.toHaveProperty("load");
    expect(props?.compositions[0]).not.toHaveProperty("load");
  });

  it("renders a controlled error without loading a demo when mounter is missing", async () => {
    const demoLoad = vi.fn(async () => ({ default: () => "demo" }));
    window.history.replaceState(null, "", "/#ui%2Fbutton?preview=compositions&name=primary");

    await act(async () => {
      controller = startPreview({ components: [component({ demoLoad })] });
      await controller.refresh();
    });

    expect(document.querySelector('[data-preview-state="missing-mounter"]')).not.toBeNull();
    expect(demoLoad).not.toHaveBeenCalled();
  });

  it("awaits mounter cleanup before mounting the next demo", async () => {
    const events: string[] = [];
    const entry = component({});
    entry.compositions.push({
      id: "secondary",
      route: "#ui%2Fbutton?preview=compositions&name=secondary",
      load: async () => ({ default: "secondary" }),
    });
    const mounter = vi.fn(async (value: unknown, root: HTMLElement) => {
      const label = String(value);
      events.push(`mount:${label}`);
      root.textContent = label;
      return async () => {
        await Promise.resolve();
        events.push(`cleanup:${label}`);
      };
    });
    window.history.replaceState(null, "", "/#ui%2Fbutton?preview=compositions&name=primary");

    await act(async () => {
      controller = startPreview({ components: [entry], mounter });
      await controller.refresh();
    });
    window.history.replaceState(null, "", "/#ui%2Fbutton?preview=compositions&name=secondary");
    await act(async () => {
      await controller?.refresh();
    });

    expect(events).toEqual(["mount:primary", "cleanup:primary", "mount:secondary"]);
    expect(document.querySelector("[data-preview-composition-host]")?.textContent).toBe("secondary");
  });

  it("refreshes the active lazy docs route", async () => {
    let version = 0;
    const docsLoad = vi.fn(async () => {
      version += 1;
      const label = `Docs ${version}`;
      return { default: () => createElement("p", undefined, label) };
    });
    window.history.replaceState(null, "", "/#ui%2Fbutton?preview=docs");

    await act(async () => {
      controller = startPreview({ components: [component({ docsLoad })] });
      await controller.refresh();
    });
    await act(async () => {
      await controller?.refresh();
    });

    expect(docsLoad.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('[data-preview-state="docs"]')?.textContent).toContain(`Docs ${version}`);
  });

  it("renders controlled invalid-route and docs-loader error states", async () => {
    window.history.replaceState(null, "", "/#ui%2Fbutton?preview=compositions");
    await act(async () => {
      controller = startPreview({ components: [component({})] });
      await controller.refresh();
    });
    expect(document.querySelector('[data-preview-state="invalid-route"]')).not.toBeNull();

    window.history.replaceState(null, "", "/#ui%2Fbutton?preview=docs");
    const docsLoad = vi.fn(async () => {
      throw new Error("docs import failed");
    });
    await act(async () => {
      await controller?.stop();
      controller = startPreview({ components: [component({ docsLoad })] });
      await controller.refresh();
    });
    expect(document.querySelector('[data-preview-state="error"]')?.textContent).toContain("docs import failed");
  });

  it("rerenders on hashchange without replacing the document", async () => {
    const documentElement = document.documentElement;
    window.history.replaceState(null, "", "/#ui%2Fbutton");
    await act(async () => {
      controller = startPreview({ components: [component({})] });
      await controller.refresh();
    });

    window.history.replaceState(null, "", "/#ui%2Fbutton?preview=docs");
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      await Promise.resolve();
      await controller?.refresh();
    });
    expect(document.documentElement).toBe(documentElement);
    expect(document.querySelector('[data-preview-state="docs"]')).not.toBeNull();
  });

  it("gives each framework mount a fresh owned host and cleans up on shutdown", async () => {
    const cleanup = vi.fn();
    const mounter = vi.fn((_value: unknown, root: HTMLElement) => {
      root.dataset.frameworkOwned = "";
      return cleanup;
    });
    window.history.replaceState(null, "", "/#ui%2Fbutton?preview=compositions&name=primary");
    await act(async () => {
      controller = startPreview({ components: [component({})], mounter });
      await controller.refresh();
    });
    const firstHost = document.querySelector<HTMLElement>("[data-preview-composition-host]");

    await act(async () => {
      await controller?.refresh();
    });
    const secondHost = document.querySelector<HTMLElement>("[data-preview-composition-host]");
    expect(firstHost?.isConnected).toBe(false);
    expect(secondHost).not.toBe(firstHost);
    expect(cleanup).toHaveBeenCalled();

    await act(async () => controller?.stop());
    expect(secondHost?.isConnected).toBe(false);
    expect(cleanup.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

function component(options: {
  docsLoad?: PreviewBrowserDocs["load"];
  demoLoad?: PreviewBrowserComposition["load"];
}): PreviewBrowserComponent {
  return {
    component: { id: "ui/button" },
    docs: {
      title: "Button",
      route: "#ui%2Fbutton?preview=docs",
      load: options.docsLoad ?? (async () => ({ default: () => createElement("p", undefined, "Docs") })),
    },
    compositions: [
      {
        id: "primary",
        route: "#ui%2Fbutton?preview=compositions&name=primary",
        load: options.demoLoad ?? (async () => ({ default: "primary" })),
      },
    ],
  };
}

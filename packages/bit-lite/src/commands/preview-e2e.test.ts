import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { parseCliArguments } from "bit-lite-context";
import { PreviewProxyServer, findAvailablePort, preparePreviewEnv } from "bit-lite-preview/node";
import startVitePreviewVendor from "demo-vendors/previewers/vite";
import startWebpackPreviewVendor from "demo-vendors/previewers/webpack";
import { describe, expect, it } from "vitest";
import type { PreviewServiceResult, PreviewVendorRuntime } from "./preview.js";
import type { VendorMessage, VendorRuntime } from "bit-lite-vendors";

const require = createRequire(import.meta.url);

describe("prepared preview end-to-end", () => {
  it.each([
    {
      name: "vite",
      startVendor: startVitePreviewVendor,
      configFile: "demo-config/previewers/vite-static",
      demoFile: "primary.demo.ts",
      demoSource: [
        'export function Primary(root) { root.textContent = "Vite demo"; }',
        'export function MySecondDemo(root) { root.textContent = "Vite second demo"; }',
      ].join("\n"),
    },
    {
      name: "webpack",
      startVendor: startWebpackPreviewVendor,
      configFile: "demo-config/previewers/webpack-react",
      demoFile: "primary.demo.tsx",
      demoSource: [
        'import { createElement } from "react";',
        'export const Primary = () => createElement("p", null, "Webpack demo");',
        'export const MySecondDemo = () => createElement("p", null, "Webpack second demo");',
      ].join("\n"),
    },
  ])("serves one $name document and logical entry with lazy docs/demo modules and HMR", async (variant) => {
    const repoRoot = path.resolve(process.cwd(), "../..");
    const tempRoot = path.join(repoRoot, "packages", "demo-workspace", ".bit-lite");
    await mkdir(tempRoot, { recursive: true });
    const workspaceRoot = await mkdtemp(path.join(tempRoot, `preview-e2e-${variant.name}-`));
    let stopVendor: (() => Promise<void> | void) | undefined;
    let closeProxy: (() => Promise<void>) | undefined;
    let cleanupPrepared: (() => Promise<void>) | undefined;
    let preparedTempDir: string | undefined;

    try {
      const componentRoot = path.join(workspaceRoot, "components", "sample");
      await mkdir(componentRoot, { recursive: true });
      await Promise.all([
        writeFile(path.join(workspaceRoot, "package.json"), '{"type":"module"}\n', "utf8"),
        writeFile(
          path.join(componentRoot, "sample.docs.mdx"),
          '---\ntitle: E2E docs\n---\n# Documentation\n<div data-e2e-docs="">MDX body</div>\n',
          "utf8"
        ),
        writeFile(path.join(componentRoot, variant.demoFile), variant.demoSource, "utf8"),
      ]);
      const vendorPort = await findAvailablePort("127.0.0.1", variant.name === "vite" ? 46_000 : 46_100);
      const proxy = new PreviewProxyServer({
        envs: [
          {
            envName: variant.name,
            taskId: variant.name,
            vendor: `${variant.name}-preview`,
            status: "starting",
            components: [{ id: "components/sample" }],
          },
        ],
        skipped: [],
      });
      closeProxy = () => proxy.close();
      await proxy.start("127.0.0.1", variant.name === "vite" ? 45_000 : 45_100);
      const prepared = await preparePreviewEnv({
        envName: variant.name,
        components: [{ id: "components/sample", rootDir: componentRoot, packageName: "@scope/sample" }],
        serviceConfig: {
          vendor: `${variant.name}-preview`,
          config: {
            configFile: require.resolve(variant.configFile),
            mounter: require.resolve(
              variant.name === "vite"
                ? "demo-config/previewers/static-mounter"
                : "demo-config/previewers/react-mounter"
            ),
            docsTemplate: require.resolve("demo-config/previewers/docs-template"),
          },
        },
        workspaceRoot,
        server: {
          host: "127.0.0.1",
          port: vendorPort,
          basePath: `/env/${variant.name}/`,
          proxyOrigin: proxy.origin,
        },
      });
      cleanupPrepared = () => prepared.cleanup();
      preparedTempDir = prepared.tempDir;
      const generatedEntry = await readFile(prepared.runtime.prepared.entryFile, "utf8");
      expect(generatedEntry.match(new RegExp(variant.demoFile.replaceAll(".", "\\."), "g"))).toHaveLength(2);
      expect(generatedEntry).toContain('.then((module) => module["Primary"])');
      expect(generatedEntry).toContain('.then((module) => module["MySecondDemo"])');
      proxy.updatePreparedComponents(variant.name, prepared.runtime.server.basePath, prepared.components);
      const harness = createHarness(variant.name, workspaceRoot, prepared);
      const handle = await variant.startVendor(harness.runtime as never);
      stopVendor = () => handle.stop?.();
      proxy.updateServer(
        variant.name,
        {
          origin: `http://127.0.0.1:${vendorPort}`,
          host: "127.0.0.1",
          port: vendorPort,
          basePath: prepared.runtime.server.basePath,
        },
        `${variant.name}-preview`
      );

      const base = `${proxy.origin}${prepared.runtime.server.basePath}`;
      const html = await fetch(base).then((response) => response.text());
      const entryUrl = new URL(readModuleScriptSource(html), base);
      const entryResponse = await fetch(entryUrl);
      const entry = await entryResponse.text();
      expect(html).toContain('id="preview-root"');
      expect(html.match(/__bit-lite\/preview\.js/g)).toHaveLength(1);
      expect(entryUrl.pathname).toBe(`/env/${variant.name}/__bit-lite/preview.js`);
      expect(entryResponse.status).toBe(200);
      expect(entry).toContain("sample.docs.mdx");
      expect(entry).toContain(variant.demoFile);
      expect(entry).toContain("previewController.refresh");

      if (variant.name === "vite") {
        const browserRuntimeUrl = new URL(readBrowserRuntimeSource(entry), base);
        const browserRuntimeResponse = await fetch(browserRuntimeUrl);
        const browserRuntimeSource = await browserRuntimeResponse.text();
        expect(browserRuntimeResponse.status).toBe(200);
        expect(browserRuntimeSource).toMatch(/\.bit-lite\/vite-preview\/env-vite\/deps\/react\.js/);
        expect(browserRuntimeSource).not.toMatch(/@fs.*react\/index\.js/);
        const docs = await fetch(`${base}components/sample/sample.docs.mdx?import`);
        const demo = await fetch(`${base}components/sample/${variant.demoFile}`);
        expect(docs.status).toBe(200);
        expect(await docs.text()).toContain("data-e2e-docs");
        expect(demo.status).toBe(200);
        expect(await demo.text()).toContain("Vite demo");
        expect(entry).toContain("createHotContext");
      } else {
        const chunkFiles = readWebpackLazyChunkFiles(entry);
        expect(chunkFiles.length).toBeGreaterThanOrEqual(2);
        expect(chunkFiles.filter((file) => file.includes("demo"))).toHaveLength(1);
        for (const chunkFile of chunkFiles) {
          expect((await fetch(`${base}__bit-lite/${chunkFile}`)).status).toBe(200);
        }
        expect(entry).toContain("__webpack_hmr");
      }

      const component = proxy.manifest().envs[0]?.components[0];
      expect(component?.overviewRoute).toBe(`/env/${variant.name}/#components%2Fsample`);
      expect(component?.docsRoute).toContain("?preview=docs");
      expect(component?.compositions).toEqual([
        {
          id: "primary/Primary",
          exportName: "Primary",
          name: "Primary",
          route: `/env/${variant.name}/#components%2Fsample?preview=compositions&name=primary%2FPrimary`,
        },
        {
          id: "primary/MySecondDemo",
          exportName: "MySecondDemo",
          name: "My Second Demo",
          route: `/env/${variant.name}/#components%2Fsample?preview=compositions&name=primary%2FMySecondDemo`,
        },
      ]);
      expect(harness.messages).toContainEqual(expect.objectContaining({ type: "status", status: "ready" }));
    } finally {
      await stopVendor?.();
      await closeProxy?.();
      await cleanupPrepared?.();
      await removePreviewTestWorkspace(workspaceRoot);
    }

    expect(preparedTempDir).toBeDefined();
    await expect(access(preparedTempDir!)).rejects.toThrow();
  }, 30_000);
});

function createHarness(name: string, workspaceRoot: string, prepared: Awaited<ReturnType<typeof preparePreviewEnv>>) {
  const messages: VendorMessage<PreviewServiceResult>[] = [];
  const runtime: VendorRuntime<Record<string, unknown>, PreviewServiceResult, never, PreviewVendorRuntime> = {
    data: {
      envName: name,
      components: [],
      config: prepared.serviceConfig.config as Record<string, unknown>,
      args: parseCliArguments([]),
      context: {
        workspaceRoot,
        config: { envs: {}, components: {} },
        envs: {},
        components: [],
        groups: [],
      },
      runtime: prepared.runtime,
    },
    postMessage(message) {
      messages.push(message);
    },
    onMessage() {
      return () => undefined;
    },
  };
  return { runtime, messages };
}

function readWebpackLazyChunkFiles(entry: string) {
  return Array.from(entry.matchAll(/"([^"]*(?:docs|demo)[^"]*)":"([a-f0-9]+)"/g), (match) => `${match[1]}.${match[2]}.js`);
}

function readModuleScriptSource(html: string) {
  const match = /\bsrc=["']([^"']*__bit-lite\/preview\.js[^"']*)["']/i.exec(html);
  if (!match?.[1]) throw new Error("Prepared preview HTML is missing its module script");
  return match[1];
}

function readBrowserRuntimeSource(entry: string) {
  const match = /from\s+["']([^"']*bit-lite-preview\/dist\/browser\/index\.js[^"']*)["']/.exec(entry);
  if (!match?.[1]) throw new Error("Transformed preview entry is missing the browser runtime import");
  return match[1];
}

async function removePreviewTestWorkspace(workspaceRoot: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await rm(workspaceRoot, { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      await access(workspaceRoot);
    } catch {
      return;
    }
  }
  throw new Error(`preview test workspace was recreated during cleanup: ${workspaceRoot}`);
}

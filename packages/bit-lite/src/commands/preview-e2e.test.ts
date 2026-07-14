import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { parseCliArguments } from "bit-lite-context";
import startVitePreviewVendor from "demo-vendors/previewers/vite";
import startWebpackPreviewVendor from "demo-vendors/previewers/webpack";
import { describe, expect, it } from "vitest";
import { PreviewProxyServer, findAvailablePort } from "./preview-proxy.js";
import { preparePreviewEnv } from "./preview-prepare.js";
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
      demoSource: 'export const title = "Primary"; export default function demo(root) { root.textContent = "Vite demo"; }\n',
    },
    {
      name: "webpack",
      startVendor: startWebpackPreviewVendor,
      configFile: "demo-config/previewers/webpack-react",
      demoFile: "primary.demo.tsx",
      demoSource:
        'import { createElement } from "react"; export const title = "Primary"; export default () => createElement("p", null, "Webpack demo");\n',
    },
  ])("serves one $name document and logical entry with lazy docs/demo modules and HMR", async (variant) => {
    const repoRoot = path.resolve(process.cwd(), "../..");
    const workspaceRoot = await mkdtemp(path.join(repoRoot, `.bit-lite-preview-e2e-${variant.name}-`));
    const componentRoot = path.join(workspaceRoot, "components", "sample");
    await mkdir(componentRoot, { recursive: true });
    await symlink(path.join(repoRoot, "packages", "demo-config", "node_modules"), path.join(workspaceRoot, "node_modules"), "dir");
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
    await proxy.start("127.0.0.1", variant.name === "vite" ? 45_000 : 45_100);
    const prepared = await preparePreviewEnv({
      envName: variant.name,
      components: [{ id: "components/sample", rootDir: componentRoot }],
      serviceConfig: {
        vendor: `${variant.name}-preview`,
        config: {
          configFile: require.resolve(variant.configFile),
          mounter: require.resolve(
            variant.name === "vite" ? "demo-config/previewers/static-mounter" : "demo-config/previewers/react-mounter"
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
    proxy.updatePreparedComponents(variant.name, prepared.runtime.server.basePath, prepared.components);
    const harness = createHarness(variant.name, workspaceRoot, prepared);
    let handle;
    try {
      handle = await variant.startVendor(harness.runtime as never);
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
      const entryResponse = await fetch(`${base}__bit-lite/preview.js`);
      const entry = await entryResponse.text();
      expect(html).toContain('id="preview-root"');
      expect(html.match(/__bit-lite\/preview\.js/g)).toHaveLength(1);
      expect(entryResponse.status).toBe(200);
      expect(entry).toContain("sample.docs.mdx");
      expect(entry).toContain(variant.demoFile);
      expect(entry).toContain("previewController.refresh");

      if (variant.name === "vite") {
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
        for (const chunkFile of chunkFiles) {
          expect((await fetch(`${base}__bit-lite/${chunkFile}`)).status).toBe(200);
        }
        expect(entry).toContain("__webpack_hmr");
      }

      const component = proxy.manifest().envs[0]?.components[0];
      expect(component?.overviewRoute).toBe(`/env/${variant.name}/#components%2Fsample`);
      expect(component?.docsRoute).toContain("?preview=docs");
      expect(component?.compositions[0]?.route).toContain("?preview=compositions&name=primary");
      expect(harness.messages).toContainEqual(expect.objectContaining({ type: "status", status: "ready" }));
    } finally {
      await handle?.stop?.();
      await proxy.close();
      await prepared.cleanup();
      await rm(workspaceRoot, { recursive: true, force: true });
    }

    await expect(access(prepared.tempDir)).rejects.toThrow();
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

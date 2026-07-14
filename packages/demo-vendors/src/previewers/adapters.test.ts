import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { parseCliArguments } from "bit-lite-context";
import { createPreviewHtml, type PreviewPreparedRuntime } from "bit-lite-preview/node";
import { mergeConfig } from "vite";
import { describe, expect, it } from "vitest";
import startVitePreviewVendor, {
  createVitePreviewCacheDir,
  createViteWorkspaceAliases,
} from "./vite/index.js";
import startWebpackPreviewVendor, { createWebpackWorkspaceAliases } from "./webpack/index.js";
import type { PreviewServiceResult, PreviewVendorRuntime } from "./core.js";
import type { VendorMessage, VendorRuntime } from "bit-lite-vendors";

describe("thin preview vendor adapters", () => {
  it.each([
    ["vite", startVitePreviewVendor, "export default {};\n"],
    ["webpack", startWebpackPreviewVendor, "export default { mode: 'development' };\n"],
  ] as const)("%s serves one prepared document and entry, then closes", async (_name, startVendor, configSource) => {
    const fixture = await createFixture(configSource);
    const port = await findFreePort();
    const harness = createHarness(fixture.configFile, fixture.entryFile, fixture.htmlFile, port);
    const handle = await startVendor(harness.runtime);
    const origin = `http://127.0.0.1:${port}`;

    const documentUrl = `${origin}/env/test/`;
    const htmlResponse = await fetch(documentUrl);
    const html = await htmlResponse.text();
    const entryUrl = new URL(readModuleScriptSource(html), documentUrl);
    const entryResponse = await fetch(entryUrl);
    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('id="preview-root"');
    expect(entryUrl.pathname).toBe("/env/test/__bit-lite/preview.js");
    expect(entryResponse.status).toBe(200);
    expect(await entryResponse.text()).toContain("prepared-entry-ran");
    expect(harness.messages).toContainEqual(expect.objectContaining({ type: "status", status: "ready" }));

    await handle.stop?.();
    await expect(fetch(`${origin}/env/test/`)).rejects.toThrow();
    expect(harness.messages).toContainEqual(expect.objectContaining({ type: "status", status: "stopped" }));
  }, 30_000);

  it.each([
    ["vite", startVitePreviewVendor],
    ["webpack", startWebpackPreviewVendor],
  ] as const)("%s reports config failures with env and vendor context", async (name, startVendor) => {
    const fixture = await createFixture("export default {};\n");
    const port = await findFreePort();
    const harness = createHarness(path.join(fixture.root, "missing-config.mjs"), fixture.entryFile, fixture.htmlFile, port);

    await expect(startVendor(harness.runtime)).rejects.toThrow(`${name}-preview failed for preview env "test-env"`);
    expect(harness.messages).toContainEqual(expect.objectContaining({ type: "status", status: "error" }));
    expect(harness.messages).toContainEqual(expect.objectContaining({ type: "status", status: "stopped" }));
  });

  it("merges Vite workspace aliases ahead of conflicting user aliases and preserves unrelated aliases", () => {
    const runtime = createPreviewRuntime("/workspace", "/tmp/entry.mjs", "/tmp/index.html", 6000);
    const merged = mergeConfig(
      {
        resolve: {
          alias: [
            { find: "@scope/example", replacement: "/user/example" },
            { find: "unrelated", replacement: "/user/unrelated" },
          ],
        },
      },
      { resolve: { alias: createViteWorkspaceAliases(runtime) } }
    );

    expect(merged.resolve?.alias).toEqual([
      { find: "@scope/example", replacement: "/workspace/components/example" },
      { find: "@scope/second", replacement: "/workspace/components/second" },
      { find: "@scope/example", replacement: "/user/example" },
      { find: "unrelated", replacement: "/user/unrelated" },
    ]);
  });

  it("isolates Vite dependency optimizer caches by preview env under workspace .bit-lite", () => {
    const nodeRuntime = createPreviewRuntime(
      "/workspace",
      "/tmp/node-entry.mjs",
      "/tmp/node-index.html",
      6000,
      "/env/node/"
    );
    const vueRuntime = createPreviewRuntime(
      "/workspace",
      "/tmp/vue-entry.mjs",
      "/tmp/vue-index.html",
      6001,
      "/env/vue/"
    );

    expect(createVitePreviewCacheDir(nodeRuntime)).toBe("/workspace/.bit-lite/vite-preview/env-node");
    expect(createVitePreviewCacheDir(vueRuntime)).toBe("/workspace/.bit-lite/vite-preview/env-vue");
    expect(createVitePreviewCacheDir(nodeRuntime)).not.toBe(createVitePreviewCacheDir(vueRuntime));
  });

  it("merges exact Webpack workspace aliases and preserves only unrelated user aliases", () => {
    const runtime = createPreviewRuntime("/workspace", "/tmp/entry.mjs", "/tmp/index.html", 6000);

    expect(
      createWebpackWorkspaceAliases(
        {
          "@scope/example": "/user/example",
          "@scope/second$": "/user/second",
          unrelated: "/user/unrelated",
        },
        runtime
      )
    ).toEqual({
      "@scope/example$": "/workspace/components/example",
      "@scope/second$": "/workspace/components/second",
      unrelated: "/user/unrelated",
    });
  });

  it("preserves Webpack alias-array entries that target unrelated packages", () => {
    const runtime = createPreviewRuntime("/workspace", "/tmp/entry.mjs", "/tmp/index.html", 6000);

    expect(
      createWebpackWorkspaceAliases(
        [
          { name: "@scope/example", alias: "/user/example", onlyModule: true },
          { name: "unrelated", alias: "/user/unrelated" },
        ],
        runtime
      )
    ).toEqual([
      { name: "@scope/example", alias: "/workspace/components/example", onlyModule: true },
      { name: "@scope/second", alias: "/workspace/components/second", onlyModule: true },
      { name: "unrelated", alias: "/user/unrelated" },
    ]);
  });
});

async function createFixture(configSource: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-preview-vendor-"));
  const preparedDir = path.join(root, "prepared");
  await mkdir(preparedDir, { recursive: true });
  const configFile = path.join(root, "config.mjs");
  const entryFile = path.join(preparedDir, "entry.mjs");
  const htmlFile = path.join(preparedDir, "index.html");
  await Promise.all([
    writeFile(configFile, configSource, "utf8"),
    writeFile(entryFile, 'globalThis.__preview_marker = "prepared-entry-ran";\n', "utf8"),
    writeFile(htmlFile, createPreviewHtml(), "utf8"),
  ]);
  return { root, configFile, entryFile, htmlFile };
}

function createHarness(configFile: string, entryFile: string, htmlFile: string, port: number) {
  const messages: VendorMessage<PreviewServiceResult>[] = [];
  const runtime: VendorRuntime<Record<string, unknown>, PreviewServiceResult, never, PreviewVendorRuntime> = {
    data: {
      envName: "test-env",
      components: [],
      config: { configFile },
      args: parseCliArguments([]),
      context: {
        workspaceRoot: path.dirname(configFile),
        config: { envs: {}, components: {} },
        envs: {},
        components: [],
        groups: [],
      },
      runtime: {
        ...createPreviewRuntime(path.dirname(configFile), entryFile, htmlFile, port),
      },
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

function createPreviewRuntime(
  workspaceRoot: string,
  entryFile: string,
  htmlFile: string,
  port: number,
  basePath = "/env/test/"
): PreviewPreparedRuntime {
  return {
    server: {
      host: "127.0.0.1",
      port,
      basePath,
      proxyOrigin: "http://127.0.0.1:4000",
    },
    prepared: { entryFile, htmlFile },
    workspace: {
      rootDir: workspaceRoot,
      components: [
        { packageName: "@scope/example", sourceDir: "/workspace/components/example" },
        { packageName: "@scope/second", sourceDir: "/workspace/components/second" },
      ],
    },
  };
}

async function findFreePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a preview test port");
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

function readModuleScriptSource(html: string) {
  const match = /\bsrc=["']([^"']*__bit-lite\/preview\.js[^"']*)["']/i.exec(html);
  if (!match?.[1]) throw new Error("Prepared preview HTML is missing its module script");
  return match[1];
}

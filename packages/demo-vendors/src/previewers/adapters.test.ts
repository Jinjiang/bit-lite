import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { parseCliArguments } from "bit-lite-context";
import { createPreviewHtml } from "bit-lite-preview/node";
import { describe, expect, it } from "vitest";
import startVitePreviewVendor from "./vite/index.js";
import startWebpackPreviewVendor from "./webpack/index.js";
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

    const htmlResponse = await fetch(`${origin}/env/test/`);
    const entryResponse = await fetch(`${origin}/env/test/__bit-lite/preview.js`);
    expect(htmlResponse.status).toBe(200);
    expect(await htmlResponse.text()).toContain('id="preview-root"');
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
    writeFile(htmlFile, createPreviewHtml("/env/test/"), "utf8"),
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
        server: {
          host: "127.0.0.1",
          port,
          basePath: "/env/test/",
          proxyOrigin: "http://127.0.0.1:4000",
        },
        prepared: { entryFile, htmlFile },
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

import { describe, expect, it } from "vitest";
import { readPreviewPreparedRuntime } from "./node.js";

describe("prepared preview runtime", () => {
  it("reads the minimal JSON contract", () => {
    expect(
      readPreviewPreparedRuntime({
        server: { host: "127.0.0.1", port: 6000, basePath: "/env/react/", proxyOrigin: "http://127.0.0.1:4000" },
        prepared: { entryFile: "/tmp/entry.mjs", htmlFile: "/tmp/index.html" },
        workspace: {
          rootDir: "/workspace",
          components: [{ packageName: "@scope/ui.button", sourceDir: "/workspace/components/button" }],
        },
      })
    ).toEqual({
      server: { host: "127.0.0.1", port: 6000, basePath: "/env/react/", proxyOrigin: "http://127.0.0.1:4000" },
      prepared: { entryFile: "/tmp/entry.mjs", htmlFile: "/tmp/index.html" },
      workspace: {
        rootDir: "/workspace",
        components: [{ packageName: "@scope/ui.button", sourceDir: "/workspace/components/button" }],
      },
    });
  });

  it("rejects legacy flat runtime data", () => {
    expect(() =>
      readPreviewPreparedRuntime({
        host: "127.0.0.1",
        port: 6000,
        basePath: "/env/react/",
        proxyOrigin: "http://127.0.0.1:4000",
      })
    ).toThrow("runtime.server is missing");
  });

  it("rejects missing or malformed workspace alias descriptors", () => {
    const baseRuntime = {
      server: { host: "127.0.0.1", port: 6000, basePath: "/env/react/", proxyOrigin: "http://127.0.0.1:4000" },
      prepared: { entryFile: "/tmp/entry.mjs", htmlFile: "/tmp/index.html" },
    };

    expect(() => readPreviewPreparedRuntime(baseRuntime)).toThrow("runtime.workspace is missing");
    expect(() =>
      readPreviewPreparedRuntime({
        ...baseRuntime,
        workspace: { rootDir: "/workspace", components: [{ packageName: "@scope/ui.button" }] },
      })
    ).toThrow("workspace.components[0].sourceDir is missing");
  });
});

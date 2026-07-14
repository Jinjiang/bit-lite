import { describe, expect, it } from "vitest";
import { readPreviewPreparedRuntime } from "./node.js";

describe("prepared preview runtime", () => {
  it("reads the minimal JSON contract", () => {
    expect(
      readPreviewPreparedRuntime({
        server: { host: "127.0.0.1", port: 6000, basePath: "/env/react/", proxyOrigin: "http://127.0.0.1:4000" },
        prepared: { entryFile: "/tmp/entry.mjs", htmlFile: "/tmp/index.html" },
      })
    ).toEqual({
      server: { host: "127.0.0.1", port: 6000, basePath: "/env/react/", proxyOrigin: "http://127.0.0.1:4000" },
      prepared: { entryFile: "/tmp/entry.mjs", htmlFile: "/tmp/index.html" },
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
});

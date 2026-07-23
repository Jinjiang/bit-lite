import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createComponentFileMap,
  escapeHtml,
  formatError,
  formatExitCode,
  isFileUrl,
  isJsonObject,
  isJsonValue,
  isPortUnavailableError,
  isRecord,
  readDefaultExport,
  readHost,
  readPackageName,
  readPort,
  readStringRecord,
  sanitizeFileName,
  sortStringRecord,
  throwCombinedErrors,
} from "./index.js";

describe("browser-safe utility entry", () => {
  it("does not import Node built-ins", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/(?:from|import)\s*["']node:/);
  });
});

describe("record utilities", () => {
  it("recognizes non-array records", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  it("reads only string-valued entries", () => {
    expect(readStringRecord({ a: "one", b: 2, c: "three" })).toEqual({
      a: "one",
      c: "three",
    });
    expect(readStringRecord(undefined)).toEqual({});
  });

  it("sorts records without mutating the input", () => {
    const input = { z: "last", a: "first" };
    expect(sortStringRecord(input)).toEqual({ a: "first", z: "last" });
    expect(Object.keys(input)).toEqual(["z", "a"]);
  });
});

describe("JSON utilities", () => {
  it("validates finite JSON recursively by default", () => {
    expect(isJsonValue({ items: [null, true, 1, "value"] })).toBe(true);
    expect(isJsonObject({ value: Number.NaN })).toBe(false);
    expect(isJsonValue([Number.POSITIVE_INFINITY])).toBe(false);
  });

  it("can preserve consumers that accept non-finite numbers", () => {
    const options = { numberPolicy: "allow-non-finite" } as const;
    expect(isJsonValue({ values: [Number.NaN, Number.POSITIVE_INFINITY] }, options)).toBe(
      true
    );
    expect(isJsonObject({ value: Number.NEGATIVE_INFINITY }, options)).toBe(true);
  });
});

describe("string and URL utilities", () => {
  it("sanitizes file names with a configurable fallback", () => {
    expect(sanitizeFileName(" @scope/pkg ")).toBe("scope-pkg");
    expect(sanitizeFileName("***")).toBe("env");
    expect(sanitizeFileName("***", "preview")).toBe("preview");
  });

  it("escapes HTML-sensitive characters", () => {
    expect(escapeHtml(`<a title="'">&</a>`)).toBe(
      "&lt;a title=&quot;&#39;&quot;&gt;&amp;&lt;/a&gt;"
    );
  });

  it("recognizes valid file URLs", () => {
    expect(isFileUrl("file:///tmp/example.ts")).toBe(true);
    expect(isFileUrl("https://example.com")).toBe(false);
    expect(isFileUrl("not a URL")).toBe(false);
  });
});

describe("generic result utilities", () => {
  it("maps target files to aligned component results", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    expect(
      createComponentFileMap(
        [{ files: ["./a.ts"] }, { files: ["./b.ts"] }],
        [first, second],
        (filePath) => filePath.replace("./", "/root/")
      )
    ).toEqual(
      new Map([
        ["/root/a.ts", first],
        ["/root/b.ts", second],
      ])
    );
  });

  it("formats exit codes", () => {
    expect(formatExitCode(0)).toBe("0");
    expect(formatExitCode(null)).toBe("unknown");
    expect(formatExitCode(undefined)).toBe("unknown");
  });

  it("retains or deduplicates repeated errors explicitly", () => {
    const error = new Error("failure");
    try {
      throwCombinedErrors([error, error], "retained");
      expect.unreachable();
    } catch (caught) {
      expect(caught).toBeInstanceOf(AggregateError);
      expect((caught as AggregateError).errors).toEqual([error, error]);
    }
    expect(() =>
      throwCombinedErrors([error, error], "deduplicated", "deduplicate")
    ).toThrow(error);
  });
});

describe("error formatting", () => {
  it("supports message-only and stack-preferred policies", () => {
    const error = new Error("failure");
    expect(formatError(error, "message-only")).toBe("failure");
    expect(formatError(error, "stack-preferred")).toContain("Error: failure");
  });

  it("supports object-message-aware formatting", () => {
    expect(formatError({ message: "structured failure" }, "object-message-aware")).toBe(
      "structured failure"
    );
    expect(formatError(42, "object-message-aware")).toBe("42");
  });
});

describe("host and port readers", () => {
  it("reads hosts with caller-owned fallbacks and errors", () => {
    const options = {
      fallback: "127.0.0.1",
      createError: () => new TypeError("invalid host"),
    };
    expect(readHost(undefined, options)).toBe("127.0.0.1");
    expect(readHost("localhost", options)).toBe("localhost");
    expect(() => readHost("", options)).toThrow(new TypeError("invalid host"));
  });

  it("reads CLI numbers and numeric strings", () => {
    const options = {
      fallback: 3000,
      acceptNumericString: true,
      createError: () => new RangeError("invalid port"),
    };
    expect(readPort(undefined, options)).toBe(3000);
    expect(readPort(4000, options)).toBe(4000);
    expect(readPort("5000", options)).toBe(5000);
    expect(() => readPort("0", options)).toThrow(new RangeError("invalid port"));
  });

  it("can require a runtime integer", () => {
    const options = {
      createError: () => new Error("runtime port required"),
    };
    expect(readPort(65535, options)).toBe(65535);
    expect(() => readPort("3000", options)).toThrow("runtime port required");
    expect(() => readPort(undefined, options)).toThrow("runtime port required");
  });
});

describe("port availability errors", () => {
  it("supports code-only matching", () => {
    const error = Object.assign(new Error("busy"), { code: "EADDRINUSE" });
    expect(isPortUnavailableError(error)).toBe(true);
    expect(isPortUnavailableError(new Error("Port 3000 is already in use"))).toBe(false);
  });

  it("supports recursive code, message, and cause matching", () => {
    const cause = Object.assign(new Error("busy"), { code: "EADDRINUSE" });
    expect(
      isPortUnavailableError(new Error("wrapper", { cause }), "recursive")
    ).toBe(true);
    expect(
      isPortUnavailableError(new Error("Port 3000 is already in use"), "recursive")
    ).toBe(true);
  });
});

describe("package manifest utilities", () => {
  it("resolves root export conditions before main", () => {
    const createMissingExportError = () => new Error("missing export");
    expect(
      readDefaultExport(
        { exports: { ".": { import: "./import.js" } }, main: "./main.js" },
        { createMissingExportError }
      )
    ).toBe("./import.js");
    expect(
      readDefaultExport(
        { exports: { ".": { custom: "./custom.js" } } },
        { conditions: ["custom"], createMissingExportError }
      )
    ).toBe("./custom.js");
    expect(() =>
      readDefaultExport({}, { createMissingExportError })
    ).toThrow("missing export");
  });

  it("validates package names with caller-owned error policies", () => {
    const createError = (reason: string) => new TypeError(reason);
    expect(readPackageName("@scope/name", { createError })).toBe("@scope/name");
    expect(() => readPackageName("", { createError })).toThrow(
      "invalid-package-name"
    );
    expect(() =>
      readPackageName("", { invalidTypeReason: "required-string", createError })
    ).toThrow("required-string");
    expect(() => readPackageName("INVALID", { createError })).toThrow(
      "invalid-package-name"
    );
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  countOf,
  createComponentFileMap,
  escapeHtml,
  formatError,
  formatErrorStack,
  formatExitCode,
  isFileUrl,
  isJsonObject,
  isJsonSerializable,
  isJsonValue,
  isPortUnavailableError,
  isRecord,
  pluralize,
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

  it("sorts records by code point without mutating the input", () => {
    const input = { z: "last", a: "first" };
    expect(sortStringRecord(input)).toEqual({ a: "first", z: "last" });
    expect(Object.keys(input)).toEqual(["z", "a"]);
    expect(Object.keys(sortStringRecord({ "a-b": "", "a.b": "", "aa": "" }))).toEqual([
      "a-b",
      "a.b",
      "aa",
    ]);
  });
});

describe("JSON utilities", () => {
  it("validates finite JSON recursively", () => {
    expect(isJsonValue({ items: [null, true, 1, "value"] })).toBe(true);
    expect(isJsonObject({ value: Number.NaN })).toBe(false);
    expect(isJsonValue([Number.POSITIVE_INFINITY])).toBe(false);
    expect(isJsonObject([])).toBe(false);
  });

  it("separately recognizes values that merely survive serialization", () => {
    expect(isJsonSerializable({ values: [Number.NaN, Number.POSITIVE_INFINITY] })).toBe(true);
    expect(isJsonSerializable({ value: () => undefined })).toBe(false);
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

  it("counts with the matching noun form", () => {
    expect(pluralize(1, "component")).toBe("component");
    expect(pluralize(0, "component")).toBe("components");
    expect(countOf(1, "component package")).toBe("1 component package");
    expect(countOf(2, "component package")).toBe("2 component packages");
    expect(countOf(2, "entry", "entries")).toBe("2 entries");
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

  it("collapses repeated failures into one report", () => {
    const error = new Error("failure");
    expect(() => throwCombinedErrors([], "none")).not.toThrow();
    expect(() => throwCombinedErrors([error, error], "repeated")).toThrow(error);

    const other = new Error("other");
    try {
      throwCombinedErrors([error, other, error], "combined");
      expect.unreachable();
    } catch (caught) {
      expect(caught).toBeInstanceOf(AggregateError);
      expect((caught as AggregateError).errors).toEqual([error, other]);
    }
  });
});

describe("error formatting", () => {
  it("shows the message, reading foreign objects that carry one", () => {
    expect(formatError(new Error("failure"))).toBe("failure");
    expect(formatError({ message: "structured failure" })).toBe("structured failure");
    expect(formatError(42)).toBe("42");
  });

  it("prefers a stack when there is one", () => {
    expect(formatErrorStack(new Error("failure"))).toContain("Error: failure");
    expect(formatErrorStack({ message: "structured failure" })).toBe("structured failure");
  });
});

describe("host and port readers", () => {
  it("reads hosts against a fallback", () => {
    expect(readHost(undefined, "--host", "127.0.0.1")).toBe("127.0.0.1");
    expect(readHost("localhost", "--host", "127.0.0.1")).toBe("localhost");
    expect(() => readHost("", "--host", "127.0.0.1")).toThrow("--host requires a host name");
  });

  it("reads numbers and their decimal spelling", () => {
    expect(readPort(undefined, "--port", 3000)).toBe(3000);
    expect(readPort(4000, "--port", 3000)).toBe(4000);
    expect(readPort("5000", "--port", 3000)).toBe(5000);
    expect(() => readPort("0", "--port", 3000)).toThrow(
      "--port requires a port number between 1 and 65535"
    );
  });

  it("requires a value when there is no fallback", () => {
    expect(readPort(65535, "runtime port")).toBe(65535);
    expect(() => readPort(undefined, "runtime port")).toThrow("runtime port requires a port");
  });
});

describe("port availability errors", () => {
  it("matches a code, a message, or anything a failure wraps", () => {
    const cause = Object.assign(new Error("busy"), { code: "EADDRINUSE" });
    expect(isPortUnavailableError(cause)).toBe(true);
    expect(isPortUnavailableError(new Error("wrapper", { cause }))).toBe(true);
    expect(isPortUnavailableError(new Error("Port 3000 is already in use"))).toBe(true);
    expect(isPortUnavailableError(new Error("unrelated"))).toBe(false);
    expect(isPortUnavailableError("EADDRINUSE")).toBe(false);
  });
});

describe("package manifest utilities", () => {
  it("resolves root export conditions before main", () => {
    expect(
      readDefaultExport(
        { exports: { ".": { import: "./import.js" } }, main: "./main.js" },
        "package"
      )
    ).toBe("./import.js");
    expect(readDefaultExport({ exports: "./only.js" }, "package")).toBe("./only.js");
    expect(readDefaultExport({ main: "./main.js" }, "package")).toBe("./main.js");
    expect(() => readDefaultExport({}, 'env package "x"')).toThrow(
      'env package "x" does not define a default package export'
    );
  });

  it("distinguishes a missing name from an invalid one", () => {
    expect(readPackageName("@scope/name", "field")).toBe("@scope/name");
    expect(() => readPackageName("", "field")).toThrow("field must be a non-empty string");
    expect(() => readPackageName(42, "field")).toThrow("field must be a non-empty string");
    expect(() => readPackageName("INVALID", "field")).toThrow(
      "field must be a valid npm package name"
    );
  });
});

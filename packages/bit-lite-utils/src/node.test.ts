import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  collectFiles,
  isFile,
  isInteractiveTerminal,
  isNodeErrorCode,
  listen,
  normalizeFilePath,
  readJsonFile,
  replaceExtension,
  sendHtml,
  toPosixPath,
} from "./node.js";

describe("Node environment utilities", () => {
  it("reads interactive terminal state", () => {
    expect(isInteractiveTerminal()).toBe(
      process.stdin.isTTY === true && process.stdout.isTTY === true
    );
  });

  it("matches Node error codes only on Error instances", () => {
    expect(
      isNodeErrorCode(Object.assign(new Error("missing"), { code: "ENOENT" }), "ENOENT")
    ).toBe(true);
    expect(isNodeErrorCode({ code: "ENOENT" }, "ENOENT")).toBe(false);
  });
});

describe("Node path and file utilities", () => {
  it("normalizes, replaces extensions, and converts separators", () => {
    expect(normalizeFilePath(".")).toBe(path.resolve("."));
    expect(replaceExtension(path.join("src", "file.ts"), ".js")).toBe(
      path.join("src", "file.js")
    );
    expect(toPosixPath(path.join("src", "file.ts"))).toBe("src/file.ts");
  });

  it("recognizes files and treats missing paths as non-files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bit-lite-utils-file-"));
    const filePath = path.join(root, "file.txt");
    await writeFile(filePath, "value", "utf8");
    expect(await isFile(filePath)).toBe(true);
    expect(await isFile(root)).toBe(false);
    expect(await isFile(path.join(root, "missing"))).toBe(false);
  });
});

describe("Node server utilities", () => {
  it("cleans up listeners after listening", async () => {
    class TestServer extends EventEmitter {
      listen() {
        queueMicrotask(() => this.emit("listening"));
        return this;
      }
    }
    const server = new TestServer();
    await listen(server as unknown as Server, "127.0.0.1", 3000);
    expect(server.listenerCount("error")).toBe(0);
    expect(server.listenerCount("listening")).toBe(0);
  });

  it("cleans up listeners after an error", async () => {
    const failure = new Error("listen failed");
    class TestServer extends EventEmitter {
      listen() {
        queueMicrotask(() => this.emit("error", failure));
        return this;
      }
    }
    const server = new TestServer();
    await expect(
      listen(server as unknown as Server, "127.0.0.1", 3000)
    ).rejects.toBe(failure);
    expect(server.listenerCount("error")).toBe(0);
    expect(server.listenerCount("listening")).toBe(0);
  });

  it("sends an HTML response", () => {
    const setHeader = vi.fn();
    const end = vi.fn();
    const response = {
      statusCode: 0,
      setHeader,
      end,
    } as unknown as ServerResponse;
    sendHtml(response, 404, "<h1>Missing</h1>");
    expect(response.statusCode).toBe(404);
    expect(setHeader).toHaveBeenCalledWith(
      "content-type",
      "text/html; charset=utf-8"
    );
    expect(end).toHaveBeenCalledWith("<h1>Missing</h1>");
  });
});

describe("file collection", () => {
  it("supports ignored directories, ignored files, filtering, and sorted output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bit-lite-utils-collect-"));
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, "src", "b.ts"), "", "utf8");
    await writeFile(path.join(root, "src", "a.js"), "", "utf8");
    await writeFile(path.join(root, "ignored.ts"), "", "utf8");
    await writeFile(path.join(root, "node_modules", "dependency.ts"), "", "utf8");
    await symlink(path.join(root, "src"), path.join(root, "linked-src"));

    const files = await collectFiles(root, {
      ignoredDirectories: new Set(["node_modules"]),
      ignoredFiles: new Set(["ignored.ts"]),
      includeFile: (fileName) => fileName.endsWith(".ts"),
      order: "sorted",
    });

    expect(files).toEqual([path.join(root, "src", "b.ts")]);
  });

  it("can ignore missing directories and use parallel traversal", async () => {
    await expect(
      collectFiles(path.join(tmpdir(), "bit-lite-utils-does-not-exist"), {
        missingDirectory: "ignore",
        traversal: "parallel",
      })
    ).resolves.toEqual([]);
  });
});

describe("JSON file reading", () => {
  it("parses JSON and maps parse failures", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bit-lite-utils-json-"));
    const validPath = path.join(root, "valid.json");
    const invalidPath = path.join(root, "invalid.json");
    await writeFile(validPath, '{"ok":true}', "utf8");
    await writeFile(invalidPath, "{", "utf8");

    await expect(readJsonFile(validPath)).resolves.toEqual({ ok: true });
    await expect(
      readJsonFile(invalidPath, {
        mapParseError: (error) =>
          new TypeError(`parse: ${error instanceof Error ? error.message : String(error)}`),
      })
    ).rejects.toThrow(/^parse:/);
  });

  it("maps read failures independently", async () => {
    await expect(
      readJsonFile(path.join(tmpdir(), "bit-lite-utils-missing.json"), {
        mapReadError: () => new TypeError("read failed"),
      })
    ).rejects.toThrow("read failed");
  });
});

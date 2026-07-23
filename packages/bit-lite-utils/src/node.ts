import { lstat, readdir, readFile, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import type { Server as HttpServer } from "node:http";
import type { Server as NetServer } from "node:net";
import path from "node:path";

export function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function normalizeFilePath(filePath: string): string {
  return path.resolve(filePath);
}

export function replaceExtension(filePath: string, extension: string): string {
  return path.join(
    path.dirname(filePath),
    `${path.basename(filePath, path.extname(filePath))}${extension}`
  );
}

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export function listen(
  server: HttpServer | NetServer,
  host: string,
  port: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off("error", handleError);
      server.off("listening", handleListening);
    };
    const handleListening = () => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, host);
  });
}

export function sendHtml(
  response: Pick<ServerResponse, "end" | "setHeader" | "statusCode">,
  statusCode: number,
  html: string
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(html);
}

export type CollectFilesOptions = {
  ignoredDirectories?: ReadonlySet<string>;
  ignoredFiles?: ReadonlySet<string>;
  includeFile?: (fileName: string, filePath: string) => boolean;
  missingDirectory?: "ignore" | "throw";
  followSymbolicLinks?: boolean;
  order?: "discovery" | "sorted";
  traversal?: "depth-first" | "parallel";
};

export async function collectFiles(
  rootDir: string,
  options: CollectFilesOptions = {}
): Promise<string[]> {
  const results: string[] = [];
  await visit(rootDir);
  return options.order === "sorted"
    ? results.sort((left, right) => left.localeCompare(right))
    : results;

  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (options.missingDirectory === "ignore") return;
      throw error;
    }

    const visitEntry = async (entry: (typeof entries)[number]) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isFile()) {
        if (
          !options.ignoredFiles?.has(entry.name) &&
          (options.includeFile?.(entry.name, entryPath) ?? true)
        ) {
          results.push(entryPath);
        }
        return;
      }

      if (options.ignoredDirectories?.has(entry.name)) return;
      if (entry.isDirectory()) {
        await visit(entryPath);
        return;
      }
      if (!entry.isSymbolicLink() || options.followSymbolicLinks !== true) return;
      const target = await lstat(entryPath);
      if (target.isDirectory()) await visit(entryPath);
      else if (
        target.isFile() &&
        !options.ignoredFiles?.has(entry.name) &&
        (options.includeFile?.(entry.name, entryPath) ?? true)
      ) {
        results.push(entryPath);
      }
    };

    if (options.traversal === "parallel") {
      await Promise.all(entries.map(visitEntry));
    } else {
      for (const entry of entries) await visitEntry(entry);
    }
  }
}

export type ReadJsonFileOptions = {
  mapReadError?: (error: unknown) => unknown;
  mapParseError?: (error: unknown) => unknown;
};

export async function readJsonFile(
  filePath: string,
  options: ReadJsonFileOptions = {}
): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    throw options.mapReadError?.(error) ?? error;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw options.mapParseError?.(error) ?? error;
  }
}

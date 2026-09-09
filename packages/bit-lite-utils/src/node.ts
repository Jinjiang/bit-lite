import { readdir, readFile, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import type { Server as HttpServer } from "node:http";
import type { Server as NetServer } from "node:net";
import path from "node:path";
import { BitLiteError, formatError } from "./index.js";

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
  return (await statOrUndefined(filePath))?.isFile() ?? false;
}

export async function isDirectory(filePath: string): Promise<boolean> {
  return (await statOrUndefined(filePath))?.isDirectory() ?? false;
}

async function statOrUndefined(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return undefined;
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
  includeFile?: (fileName: string, filePath: string) => boolean;
  /** A missing root directory yields no files instead of raising. */
  allowMissing?: boolean;
};

/**
 * Walks a directory tree and returns the files it accepts, sorted. The order is
 * fixed rather than left to the filesystem because every caller either compares
 * or records the result.
 */
export async function collectFiles(
  rootDir: string,
  options: CollectFilesOptions = {}
): Promise<string[]> {
  const results: string[] = [];
  await visit(rootDir);
  return results.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (options.allowMissing === true) return;
      throw error;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!options.ignoredDirectories?.has(entry.name)) await visit(entryPath);
          return;
        }
        if (entry.isFile() && (options.includeFile?.(entry.name, entryPath) ?? true)) {
          results.push(entryPath);
        }
      })
    );
  }
}

/**
 * Reads and parses a JSON file. Read failures reach the caller unchanged so it
 * can recognize `ENOENT`; a parse failure becomes a domain error naming the
 * file, because there is nothing a caller can do with it but report it.
 */
export async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new BitLiteError(`failed parsing ${filePath}: ${formatError(error)}`);
  }
}

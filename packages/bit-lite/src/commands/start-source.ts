import { constants } from "node:fs";
import { readFileSync } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { sendHtml, sendJson, sendText } from "bit-lite-proxy";
import type { WorkspaceComponent } from "bit-lite-context";
import type { ProxyRoute } from "bit-lite-proxy";

const startSourceHtml = readFileSync(new URL("../assets/start-source.html", import.meta.url), "utf8");

const ignoredDirectoryNames = new Set([
  ".bit-lite",
  ".git",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export const startSourceContentLimitBytes = 1024 * 1024;

type StartSourceComponent = Pick<WorkspaceComponent, "id" | "rootDir" | "mainFileRelative">;

export type StartSourceCatalog = {
  get(componentId: string): StartSourceComponent | undefined;
};

export type StartSourceFileEntry = {
  path: string;
  size: number;
};

export type StartSourceFileIndex = {
  componentId: string;
  mainFile: string;
  files: StartSourceFileEntry[];
};

type StartSourceFileSnapshotBase = {
  componentId: string;
  path: string;
  size: number;
};

export type StartSourceFileSnapshot = StartSourceFileSnapshotBase & (
  | {
      kind: "text";
      encoding: "utf-8";
      content: string;
    }
  | {
      kind: "binary";
    }
  | {
      kind: "too-large";
      limitBytes: number;
    }
);

export class StartSourceUnavailableError extends Error {
  constructor(message = "Component source is unavailable") {
    super(message);
    this.name = "StartSourceUnavailableError";
  }
}

export class StartSourceFileNotFoundError extends Error {
  constructor(message = "Source file was not found") {
    super(message);
    this.name = "StartSourceFileNotFoundError";
  }
}

export function createStartSourceCatalog(
  components: readonly StartSourceComponent[]
): StartSourceCatalog {
  const byId = new Map<string, StartSourceComponent>();
  for (const component of components) {
    if (byId.has(component.id)) {
      throw new Error(`Duplicate selected component ID: ${component.id}`);
    }
    byId.set(component.id, component);
  }
  return {
    get(componentId) {
      return byId.get(componentId);
    },
  };
}

export function createStartSourceRoute(componentId: string) {
  return `/source?component=${encodeURIComponent(componentId)}`;
}

export function createStartSourceRoutes(catalog: StartSourceCatalog): ProxyRoute[] {
  return [
    {
      id: "start:source-page",
      matches: (url) => url.pathname === "/source",
      handleHttp(request, response, { url }) {
        if (!allowGet(request.method, response)) return;
        const componentId = url.searchParams.get("component");
        if (!componentId) {
          sendText(response, 400, "A component query parameter is required");
          return;
        }
        if (!catalog.get(componentId)) {
          sendText(response, 404, "Selected component was not found");
          return;
        }
        sendHtml(response, 200, startSourceHtml);
      },
    },
    {
      id: "start:source-files",
      matches: (url) => url.pathname === "/__bit-lite/source-files.json",
      async handleHttp(request, response, { url }) {
        if (!allowGet(request.method, response)) return;
        const componentId = url.searchParams.get("component");
        if (!componentId) {
          sendJson(response, { error: "A component query parameter is required" }, 400);
          return;
        }
        const component = catalog.get(componentId);
        if (!component) {
          sendJson(response, { error: "Selected component was not found" }, 404);
          return;
        }
        try {
          sendJson(response, await readStartSourceFileIndex(component));
        } catch {
          sendJson(response, { error: "Component source is unavailable" }, 404);
        }
      },
    },
    {
      id: "start:source-file",
      matches: (url) => url.pathname === "/__bit-lite/source-file.json",
      async handleHttp(request, response, { url }) {
        if (!allowGet(request.method, response)) return;
        const componentId = url.searchParams.get("component");
        if (!componentId) {
          sendJson(response, { error: "A component query parameter is required" }, 400);
          return;
        }
        const requestedPath = url.searchParams.get("path");
        if (!requestedPath) {
          sendJson(response, { error: "A path query parameter is required" }, 400);
          return;
        }
        const component = catalog.get(componentId);
        if (!component) {
          sendJson(response, { error: "Selected component was not found" }, 404);
          return;
        }
        try {
          sendJson(response, await readStartSourceFile(component, requestedPath));
        } catch (error) {
          const message = error instanceof StartSourceUnavailableError
            ? "Component source is unavailable"
            : "Source file was not found";
          sendJson(response, { error: message }, 404);
        }
      },
    },
  ];
}

export async function readStartSourceFileIndex(
  component: StartSourceComponent
): Promise<StartSourceFileIndex> {
  const rootRealPath = await readComponentRoot(component);
  const files: StartSourceFileEntry[] = [];
  await collectSourceFiles(rootRealPath, rootRealPath, files, true);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    componentId: component.id,
    mainFile: component.mainFileRelative,
    files,
  };
}

export async function readStartSourceFile(
  component: StartSourceComponent,
  requestedPath: string
): Promise<StartSourceFileSnapshot> {
  if (!isValidRelativeSourcePath(requestedPath)) {
    throw new StartSourceFileNotFoundError();
  }

  const index = await readStartSourceFileIndex(component);
  const indexedFile = index.files.find((file) => file.path === requestedPath);
  if (!indexedFile) throw new StartSourceFileNotFoundError();

  const rootRealPath = await readComponentRoot(component);
  const filePath = path.join(rootRealPath, ...requestedPath.split("/"));
  let handle;
  try {
    const fileStat = await lstat(filePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new StartSourceFileNotFoundError();
    const fileRealPath = await realpath(filePath);
    if (!isPathInside(rootRealPath, fileRealPath)) throw new StartSourceFileNotFoundError();
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) throw new StartSourceFileNotFoundError();

    if (openedStat.size > startSourceContentLimitBytes) {
      return {
        componentId: component.id,
        path: requestedPath,
        size: openedStat.size,
        kind: "too-large",
        limitBytes: startSourceContentLimitBytes,
      };
    }

    const buffer = Buffer.alloc(startSourceContentLimitBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }

    if (bytesRead > startSourceContentLimitBytes) {
      const currentStat = await handle.stat();
      return {
        componentId: component.id,
        path: requestedPath,
        size: Math.max(currentStat.size, bytesRead),
        kind: "too-large",
        limitBytes: startSourceContentLimitBytes,
      };
    }

    const contentBytes = buffer.subarray(0, bytesRead);
    if (contentBytes.includes(0)) {
      return {
        componentId: component.id,
        path: requestedPath,
        size: bytesRead,
        kind: "binary",
      };
    }

    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(contentBytes);
    } catch {
      return {
        componentId: component.id,
        path: requestedPath,
        size: bytesRead,
        kind: "binary",
      };
    }

    return {
      componentId: component.id,
      path: requestedPath,
      size: bytesRead,
      kind: "text",
      encoding: "utf-8",
      content,
    };
  } catch (error) {
    if (error instanceof StartSourceFileNotFoundError) throw error;
    throw new StartSourceFileNotFoundError();
  } finally {
    await handle?.close();
  }
}

function isValidRelativeSourcePath(value: string) {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

async function readComponentRoot(component: StartSourceComponent) {
  try {
    const rootRealPath = await realpath(component.rootDir);
    const rootStat = await lstat(rootRealPath);
    if (!rootStat.isDirectory()) throw new StartSourceUnavailableError();
    return rootRealPath;
  } catch (error) {
    if (error instanceof StartSourceUnavailableError) throw error;
    throw new StartSourceUnavailableError();
  }
}

async function collectSourceFiles(
  rootRealPath: string,
  directory: string,
  files: StartSourceFileEntry[],
  isRoot: boolean
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    if (isRoot) throw new StartSourceUnavailableError();
    return;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name === "." || entry.name === "..") continue;
    const absolutePath = path.join(directory, entry.name);
    let entryStat;
    try {
      entryStat = await lstat(absolutePath);
    } catch {
      continue;
    }
    if (entryStat.isSymbolicLink()) continue;

    if (entryStat.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name)) continue;
      let directoryRealPath;
      try {
        directoryRealPath = await realpath(absolutePath);
      } catch {
        continue;
      }
      if (!isPathInside(rootRealPath, directoryRealPath)) continue;
      await collectSourceFiles(rootRealPath, directoryRealPath, files, false);
      continue;
    }

    if (!entryStat.isFile()) continue;
    const relativePath = toPosixPath(path.relative(rootRealPath, absolutePath));
    if (!isValidRelativeSourcePath(relativePath)) continue;
    files.push({ path: relativePath, size: entryStat.size });
  }
}

function isPathInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

function allowGet(method: string | undefined, response: Parameters<typeof sendText>[0]) {
  if (method === "GET") return true;
  response.setHeader("allow", "GET");
  sendText(response, 405, "Method not allowed");
  return false;
}

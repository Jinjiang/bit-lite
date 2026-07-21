import { readPreviewPreparedRuntime, type PreviewPreparedRuntime } from "bit-lite-preview/node";
import type { JsonObject } from "bit-lite-vendors";

export type PreviewVendorRuntime = PreviewPreparedRuntime;

export type PreviewServerInfo = JsonObject & {
  origin: string;
  host: string;
  port: number;
  basePath: string;
};

export type PreviewServiceResult = JsonObject & {
  mode: "serve";
  port: number;
};

export function readPreviewConfigFile(config: Record<string, unknown>) {
  const configFile = config.configFile;
  if (typeof configFile !== "string" || configFile.length === 0) {
    throw new Error('preview vendor config must define a resolved non-empty "configFile" string');
  }
  return configFile;
}

export { readPreviewPreparedRuntime as readPreviewRuntime };

export function createPreviewServiceResult(port: number): PreviewServiceResult {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("preview vendor must report an actual port between 1 and 65535");
  }
  return { mode: "serve", port };
}

export function isShutdownMessage(message: unknown) {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "shutdown";
}

export function withPreviewVendorContext(error: unknown, env: { packageName: string }, vendor: string) {
  return new Error(`${vendor} failed for preview env "${env.packageName}": ${formatError(error)}`, { cause: error });
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

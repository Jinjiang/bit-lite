import type { JsonObject, PreviewPackageAlias, PreviewPreparedRuntime } from "./types.js";

export type {
  PreviewPreparedRuntime,
  PreviewPackageAlias,
} from "./types.js";
export {
  createPreparedOverviewRoute,
  createPreviewEntrySource,
  createPreviewHtml,
  derivePreviewCompositionName,
  discoverPreviewComponents,
  preparePreviewEnv,
  PreviewPreparationError,
  resolvePreviewServiceConfig,
} from "./preparation.js";
export type {
  PreparedPreviewComponent,
  PreparedPreviewComposition,
  PreparedPreviewDocs,
  PreparedPreviewEnv,
  PreviewServerRuntime,
  ResolvedPreviewServiceConfig,
} from "./preparation.js";
export {
  encodeRouteSegment,
  findAvailablePort,
  PreviewProxyServer,
} from "./proxy.js";
export type {
  PreviewEnvState,
  PreviewProxyComponent,
  PreviewProxyManifest,
  PreviewServerInfo,
} from "./proxy.js";

export function readPreviewPreparedRuntime(runtime: JsonObject | undefined): PreviewPreparedRuntime {
  if (!isRecord(runtime)) throw new Error("preview vendor runtime is missing");
  const server = runtime.server;
  const prepared = runtime.prepared;
  const aliases = runtime.aliases;
  if (!isRecord(server)) throw new Error("preview vendor runtime.server is missing");
  if (!isRecord(prepared)) throw new Error("preview vendor runtime.prepared is missing");
  if (!Array.isArray(aliases)) throw new Error("preview vendor runtime.aliases is missing");

  const { host, port, basePath, proxyOrigin } = server;
  const { entryFile, htmlFile } = prepared;
  if (typeof host !== "string" || host.length === 0) {
    throw new Error("preview vendor runtime.server.host is missing");
  }
  if (typeof port !== "number" || !Number.isInteger(port)) {
    throw new Error("preview vendor runtime.server.port is missing");
  }
  if (typeof basePath !== "string" || !basePath.startsWith("/")) {
    throw new Error("preview vendor runtime.server.basePath is missing");
  }
  if (typeof proxyOrigin !== "string" || proxyOrigin.length === 0) {
    throw new Error("preview vendor runtime.server.proxyOrigin is missing");
  }
  if (typeof entryFile !== "string" || entryFile.length === 0) {
    throw new Error("preview vendor runtime.prepared.entryFile is missing");
  }
  if (typeof htmlFile !== "string" || htmlFile.length === 0) {
    throw new Error("preview vendor runtime.prepared.htmlFile is missing");
  }
  const packageAliases = aliases.map(readPackageAlias);

  return {
    server: { host, port, basePath, proxyOrigin },
    prepared: { entryFile, htmlFile },
    aliases: packageAliases,
  };
}

function readPackageAlias(value: unknown, index: number): PreviewPackageAlias {
  if (!isRecord(value)) {
    throw new Error(`preview vendor runtime.aliases[${index}] must be an object`);
  }
  const { packageName, sourceDir } = value;
  if (typeof packageName !== "string" || packageName.length === 0) {
    throw new Error(`preview vendor runtime.aliases[${index}].packageName is missing`);
  }
  if (typeof sourceDir !== "string" || sourceDir.length === 0) {
    throw new Error(`preview vendor runtime.aliases[${index}].sourceDir is missing`);
  }
  return { packageName, sourceDir };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

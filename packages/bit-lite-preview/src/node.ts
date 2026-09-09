import { isRecord, readPort } from "bit-lite-utils";
import type { JsonObject, PreviewPackageAlias, PreviewPreparedRuntime } from "./types.js";

export type {
  PreviewPreparedRuntime,
  PreviewPackageAlias,
} from "./types.js";
export {
  derivePreviewCompositionName,
  discoverPreviewComponents,
} from "./component-discovery.js";
export type {
  PreparedPreviewComponent,
  PreparedPreviewComposition,
  PreparedPreviewDocs,
} from "./component-discovery.js";
export { createPreviewEntrySource, createPreviewHtml } from "./entry-source.js";
export { PreviewPreparationError } from "./errors.js";
export {
  createPreparedOverviewRoute,
  preparePreviewEnv,
  resolvePreviewServiceConfig,
} from "./preparation.js";
export type {
  PreparedPreviewEnv,
  PreviewServerRuntime,
  ResolvedPreviewServiceConfig,
} from "./preparation.js";
export {
  createPreviewPresentationRoutes,
  createPreviewServiceRoutes,
  PreviewProxyServer,
  PreviewProxyState,
} from "./proxy.js";
export type {
  PreviewEnvState,
  PreviewProxyComponent,
  PreviewProxyManifest,
  PreviewProxyStateOptions,
  PreviewServiceRoutesOptions,
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

  const { host, preferredPort, fallbackStartPort, basePath, proxyOrigin } = server;
  const { entryFile, htmlFile } = prepared;
  if (typeof host !== "string" || host.length === 0) {
    throw new Error("preview vendor runtime.server.host is missing");
  }
  const validatedPreferredPort = readPort(preferredPort, "preview vendor runtime.server.preferredPort");
  const validatedFallbackStartPort = readPort(
    fallbackStartPort,
    "preview vendor runtime.server.fallbackStartPort"
  );
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
    server: {
      host,
      preferredPort: validatedPreferredPort,
      fallbackStartPort: validatedFallbackStartPort,
      basePath,
      proxyOrigin,
    },
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

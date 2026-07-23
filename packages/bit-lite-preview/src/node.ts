import { isRecord, readPort } from "bit-lite-utils";
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
  createPreviewPresentationRoutes,
  createPreviewServiceRoutes,
  encodeRouteSegment,
  findAvailablePort,
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
  const validatedPreferredPort = readPort(preferredPort, {
    createError: () =>
      new Error(
        "preview vendor runtime.server.preferredPort must be an integer between 1 and 65535"
      ),
  });
  const validatedFallbackStartPort = readPort(fallbackStartPort, {
    createError: () =>
      new Error(
        "preview vendor runtime.server.fallbackStartPort must be an integer between 1 and 65535"
      ),
  });
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

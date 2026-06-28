import { createServiceTask } from "../../runtime.js";
import { loadServiceVendor, pipeVendorTask, readVendorServiceConfig } from "../../service-config.js";
import { serviceResult } from "../../utils/service-result.js";
import type { BitLiteService } from "../../types/index.js";
import type { PreviewArgs, PreviewResult, PreviewVendor, PreviewVendorConfig } from "../../types/services/preview.js";
import { discoverPreviewEntries } from "./discovery.js";

const DEFAULT_ENV_PORT = 3301;
const DEFAULT_HOST = "127.0.0.1";

export const previewService: BitLiteService<unknown, PreviewArgs, PreviewResult> = {
  name: "preview",
  run(input, context) {
    return createServiceTask(async (host) => {
      const envName = context?.envName ?? "unknown";
      const serviceDefinition = readVendorServiceConfig(input.config);
      const vendor = await loadServiceVendor<PreviewVendor>("preview", serviceDefinition.vendor, context);
      const entries = await discoverPreviewEntries(input.components, envName);
      if (entries.length === 0) {
        return {
          ...serviceResult({
            ok: true,
            toJSON: () => ({
              vendor: serviceDefinition.vendor,
              envName,
              entries,
            }),
            toString: () => `preview found no preview files for ${envName}`,
          }),
          ok: true,
          vendor: serviceDefinition.vendor,
          entries,
        };
      }

      const port = typeof input.args?.port === "number" ? input.args.port : DEFAULT_ENV_PORT;
      const base = typeof input.args?.base === "string" ? input.args.base : `/env/${encodeURIComponent(envName)}/`;
      const task = vendor.run(
        {
          ...input,
          config: readPreviewVendorConfig(serviceDefinition.config),
          entries,
          base,
          port,
        },
        context
      );
      const result = await pipeVendorTask(task, host);
      if (!result.ok) return result;
      const hostName = result.host ?? DEFAULT_HOST;
      const envPort = result.port ?? port;
      const url = result.url ?? `http://${hostName}:${envPort}${base}`;
      return {
        ...result,
        ...serviceResult({
          ok: true,
          toJSON: () => ({
            vendor: serviceDefinition.vendor,
            envName,
            url,
            host: hostName,
            port: envPort,
            base,
            entries,
          }),
          toString: () => `preview ${envName} running at ${url}`,
        }),
        ok: true,
        url,
        host: hostName,
        port: envPort,
        base,
        vendor: serviceDefinition.vendor,
        entries,
      };
    });
  },
};

function readPreviewVendorConfig(value: unknown): PreviewVendorConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return {
    ...(typeof input.configFile === "string" ? { configFile: input.configFile } : {}),
  };
}

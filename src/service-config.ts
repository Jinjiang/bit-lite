export type VendorServiceConfig<VendorConfig = unknown> = {
  vendor?: string;
  config?: VendorConfig;
};

export function readObjectConfig(config: unknown): Record<string, unknown> {
  if (typeof config === "object" && config !== null && !Array.isArray(config)) return config as Record<string, unknown>;
  return {};
}

export function readVendorServiceConfig(config: unknown, defaultVendor: string): Required<VendorServiceConfig> {
  const input = readObjectConfig(config);
  return {
    vendor: typeof input.vendor === "string" ? input.vendor : defaultVendor,
    config: input.config ?? legacyVendorConfig(input),
  };
}

function legacyVendorConfig(input: Record<string, unknown>) {
  const { vendor: _vendor, config: _config, ...rest } = input;
  return rest;
}

export function unsupportedVendorResult(serviceName: string, vendor: string) {
  return {
    ok: false,
    message: `${serviceName} vendor "${vendor}" is not available`,
  };
}

export function rejectCliArgs(args: unknown, serviceName: string) {
  if (!Array.isArray(args) || args.length === 0) return;
  throw new Error(`service "${serviceName}" does not accept arguments: ${args.map(String).join(" ")}`);
}

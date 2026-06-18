import path from "node:path";
import { pathToFileURL } from "node:url";
import { isLocalModuleRef } from "./utils/path-utils.js";
import { serviceResult } from "./utils/service-result.js";
import type { ServiceContext, ServiceTask } from "./types/index.js";

export type VendorServiceConfig<VendorConfig = unknown> = {
  vendor: string;
  config?: VendorConfig;
};

export function readObjectConfig(config: unknown): Record<string, unknown> {
  if (typeof config === "object" && config !== null && !Array.isArray(config)) return config as Record<string, unknown>;
  return {};
}

export function readVendorServiceConfig(config: unknown): VendorServiceConfig {
  const input = readObjectConfig(config);
  if (typeof input.vendor !== "string") {
    throw new Error("service config requires a vendor field");
  }
  return {
    vendor: input.vendor,
    config: input.config,
  };
}

export function unsupportedVendorResult(serviceName: string, vendor: string) {
  return serviceResult({
    ok: false,
    toJSON: () => ({
      serviceName,
      vendor,
      error: "unsupported-vendor",
    }),
    toString: () => `${serviceName} vendor "${vendor}" is not available`,
  });
}

export function rejectCliArgs(args: unknown, serviceName: string) {
  if (!Array.isArray(args) || args.length === 0) return;
  throw new Error(`service "${serviceName}" does not accept arguments: ${args.map(String).join(" ")}`);
}

export async function loadServiceVendor<Vendor>(
  serviceName: string,
  vendorRef: string,
  context?: ServiceContext
): Promise<Vendor> {
  const mod = await import(resolveVendorModule(serviceName, vendorRef, context));
  const vendor = mod.default ?? findExportedVendor(mod);
  if (!isRunnableVendor(vendor)) {
    throw new Error(`service "${serviceName}" vendor "${vendorRef}" must export a vendor object with run()`);
  }
  return vendor as Vendor;
}

export async function pipeVendorTask<Result>(
  task: ServiceTask<Result>,
  host: {
    signal: AbortSignal;
    emit(type: string, payload: unknown): void;
  }
): Promise<Result> {
  const unsubscribe = task.listen((type, payload) => host.emit(type, payload));
  const abort = () => task.abort();
  if (host.signal.aborted) abort();
  host.signal.addEventListener("abort", abort, { once: true });
  try {
    return await task.result;
  } finally {
    host.signal.removeEventListener("abort", abort);
    unsubscribe();
  }
}

function resolveVendorModule(serviceName: string, vendorRef: string, context?: ServiceContext) {
  if (isLocalModuleRef(vendorRef)) {
    const vendorUrl = vendorRef.startsWith("file:")
      ? new URL(vendorRef)
      : pathToFileURL(path.resolve(requireWorkspaceRoot(context), vendorRef));
    return vendorUrl.href;
  }
  if (isBuiltinVendorName(vendorRef)) {
    return new URL(`./services/${serviceName}/vendors/${vendorRef}.js`, import.meta.url).href;
  }
  return vendorRef;
}

function requireWorkspaceRoot(context: ServiceContext | undefined) {
  if (!context?.workspaceRoot) throw new Error("local vendor references require workspaceRoot in context");
  return context.workspaceRoot;
}

function isBuiltinVendorName(value: string) {
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

function isRunnableVendor(value: unknown): value is { run: (...args: unknown[]) => unknown } {
  return typeof value === "object" && value !== null && typeof (value as { run?: unknown }).run === "function";
}

function findExportedVendor(mod: Record<string, unknown>) {
  return Object.values(mod).find(isRunnableVendor);
}

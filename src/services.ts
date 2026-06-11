import path from "node:path";
import { pathToFileURL } from "node:url";
import { builtinServices, isBitLiteService } from "./builtins.js";
import { BitLiteError } from "./errors.js";
import { isLocalModuleRef } from "./path-utils.js";
import type { BitLiteService } from "./types.js";

export async function loadService(workspaceRoot: string, serviceRef: string): Promise<BitLiteService> {
  const builtin = builtinServices[serviceRef];
  if (builtin) return builtin;

  const mod = await importServiceModule(workspaceRoot, serviceRef);
  const createService = mod.createService;
  if (typeof createService === "function") {
    return validateService(createService(), serviceRef);
  }
  if (isBitLiteService(mod.default)) {
    return mod.default;
  }
  throw new BitLiteError(`service "${serviceRef}" must export createService() or a default BitLiteService`);
}

export async function loadServicesForEnv(workspaceRoot: string, services: Record<string, unknown>) {
  const entries = await Promise.all(
    Object.entries(services).map(async ([serviceRef, config]) => {
      const service = await loadService(workspaceRoot, serviceRef);
      return {
        serviceRef,
        config,
        service,
      };
    })
  );
  return entries;
}

function validateService(value: unknown, serviceRef: string) {
  if (!isBitLiteService(value)) {
    throw new BitLiteError(`service "${serviceRef}" did not create a valid BitLiteService`);
  }
  return value;
}

async function importServiceModule(workspaceRoot: string, serviceRef: string): Promise<Record<string, unknown>> {
  if (isLocalModuleRef(serviceRef)) {
    const servicePath = serviceRef.startsWith("file:")
      ? new URL(serviceRef)
      : pathToFileURL(path.resolve(workspaceRoot, serviceRef));
    return import(servicePath.href) as Promise<Record<string, unknown>>;
  }
  return import(serviceRef) as Promise<Record<string, unknown>>;
}

import { createInspectService } from "./services/inspect/service.js";
import { createPreviewService } from "./preview.js";
import { createTestService } from "./services/test/service.js";
import { createTypecheckService } from "./services/typecheck/service.js";
import type { BitLiteService, ServiceDefinition } from "./types.js";

export const builtinServiceDefinitions: Record<string, ServiceDefinition> = {
  preview: {
    factory: createPreviewService,
  },
  inspect: {
    factory: createInspectService,
  },
  typecheck: {
    factory: createTypecheckService,
  },
  typescript: {
    factory: createTypecheckService,
  },
  test: {
    factory: createTestService,
  },
};

export function isBitLiteService(value: unknown): value is BitLiteService {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<BitLiteService>;
  return typeof candidate.name === "string" && typeof candidate.run === "function";
}

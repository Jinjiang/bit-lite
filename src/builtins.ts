import { inspectService } from "./services/inspect/service.js";
import { previewService } from "./preview.js";
import { testService } from "./services/test/service.js";
import { typecheckService } from "./services/typecheck/service.js";
import type { BitLiteService } from "./types/index.js";

export const builtinServices: Record<string, BitLiteService> = {
  preview: previewService,
  inspect: inspectService,
  typecheck: typecheckService,
  typescript: typecheckService,
  test: testService,
};

export function isBitLiteService(value: unknown): value is BitLiteService {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<BitLiteService>;
  return typeof candidate.name === "string" && typeof candidate.run === "function";
}

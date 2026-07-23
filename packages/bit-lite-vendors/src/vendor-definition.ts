import { isRecord } from "bit-lite-utils";
import type { VendorDefinition } from "./types/index.js";

export function isVendorDefinition(value: unknown): value is VendorDefinition {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.hint === "string" &&
    (typeof value.moduleUrl === "string" || value.moduleUrl instanceof URL)
  );
}

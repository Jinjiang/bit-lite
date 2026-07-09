import type { VendorDefinition, VendorRuntime, VendorStartResult } from "bit-lite-vendors";
import { startVitePreviewVendor, type PreviewServiceResult, type PreviewVendorRuntime } from "../vite/shared.js";

export const meta: VendorDefinition = {
  id: "vite-static-preview",
  label: "Vite Static Preview",
  hint: "Serve plain component docs and compositions with Vite",
  moduleUrl: import.meta.url,
};

export default function startStaticPreviewVendor(
  runtime: VendorRuntime<Record<string, unknown>, PreviewServiceResult, never, PreviewVendorRuntime>
): Promise<VendorStartResult<PreviewServiceResult>> {
  return startVitePreviewVendor(runtime, meta);
}

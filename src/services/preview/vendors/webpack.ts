import { createServiceTask } from "../../../runtime.js";
import { unsupportedVendorResult } from "../../../service-config.js";
import type { PreviewVendor } from "../types.js";

export const webpackPreviewVendor: PreviewVendor = {
  name: "webpack",
  run() {
    return createServiceTask(async () => unsupportedVendorResult("preview", "webpack"));
  },
};

export default webpackPreviewVendor;

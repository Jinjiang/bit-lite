import { createServiceTask } from "../../../runtime.js";
import { unsupportedVendorResult } from "../../../service-config.js";
import type { TypecheckVendor } from "../types.js";

export const oxcTypecheckVendor: TypecheckVendor = {
  name: "oxc",
  run() {
    return createServiceTask(async () => unsupportedVendorResult("typecheck", "oxc"));
  },
};

export default oxcTypecheckVendor;

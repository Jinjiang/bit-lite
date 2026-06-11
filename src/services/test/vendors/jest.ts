import { createServiceTask } from "../../../runtime.js";
import { unsupportedVendorResult } from "../../../service-config.js";
import type { TestVendor } from "../types.js";

export const jestTestVendor: TestVendor = {
  name: "jest",
  run() {
    return createServiceTask(async () => unsupportedVendorResult("test", "jest"));
  },
};

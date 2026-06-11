import { createServiceTask } from "../../../runtime.js";
import { unsupportedVendorResult } from "../../../service-config.js";
import type { TestVendor } from "../types.js";

export const mochaTestVendor: TestVendor = {
  name: "mocha",
  run() {
    return createServiceTask(async () => unsupportedVendorResult("test", "mocha"));
  },
};

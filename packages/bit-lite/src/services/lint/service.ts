import { createServiceTask } from "../../runtime.js";
import { loadServiceVendor, pipeVendorTask, readVendorServiceConfig } from "../../service-config.js";
import type { LintService, LintVendor } from "../../types/services/lint.js";
import { readLintArgs } from "./runtime.js";

export const lintService: LintService = {
  name: "lint",
  run(input, context) {
    return createServiceTask(async (host) => {
      const serviceConfig = readVendorServiceConfig(input.config);
      const vendor = await loadServiceVendor<LintVendor>("lint", serviceConfig.vendor, context);
      return pipeVendorTask(
        vendor.run(
          {
            ...input,
            config: serviceConfig.config,
            args: readLintArgs(input.args),
          },
          context
        ),
        host
      );
    });
  },
};

export default lintService;

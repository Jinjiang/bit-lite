import { createServiceTask } from "../../runtime.js";
import { loadServiceVendor, pipeVendorTask, readVendorServiceConfig } from "../../service-config.js";
import type { BitLiteService } from "../../types/index.js";
import type { InspectVendor } from "../../types/services/inspect.js";

export const inspectService: BitLiteService = {
  name: "inspect",
  run(input, context) {
    return createServiceTask(async (host) => {
      const serviceConfig = readVendorServiceConfig(input.config);
      const vendor = await loadServiceVendor<InspectVendor>("inspect", serviceConfig.vendor, context);
      return pipeVendorTask(
        vendor.run(
          {
            ...input,
            config: serviceConfig.config,
          },
          context
        ),
        host
      );
    });
  },
};

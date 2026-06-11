import { readVendorServiceConfig } from "../../service-config.js";
import type { ServiceFactory } from "../../types.js";
import { defaultInspectVendor } from "./vendors/default.js";

const vendors = {
  default: defaultInspectVendor,
};

export const createInspectService: ServiceFactory = () => ({
  name: "inspect",
  run(input, context) {
    const serviceConfig = readVendorServiceConfig(input.config, "default");
    const vendor = vendors[serviceConfig.vendor as keyof typeof vendors] ?? defaultInspectVendor;
    return vendor.run(
      {
        ...input,
        config: serviceConfig.config,
      },
      context
    );
  },
});

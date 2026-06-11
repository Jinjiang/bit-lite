import { createServiceTask } from "../../runtime.js";
import { loadServiceVendor, pipeVendorTask, readObjectConfig, readVendorServiceConfig } from "../../service-config.js";
import type { BitLiteService } from "../../types.js";
import type { TypecheckArgs, TypecheckVendor } from "./types.js";

export const typecheckService: BitLiteService = {
  name: "typecheck",
  run(input, context) {
    return createServiceTask(async (host) => {
      const serviceConfig = readVendorServiceConfig(input.config);
      const vendor = await loadServiceVendor<TypecheckVendor>("typecheck", serviceConfig.vendor, context);
      return pipeVendorTask(
        vendor.run(
          {
            ...input,
            config: serviceConfig.config,
            args: readTypecheckArgs(input.args),
          },
          context
        ),
        host
      );
    });
  },
};

function readTypecheckArgs(args: unknown): TypecheckArgs | string[] | undefined {
  if (Array.isArray(args)) return args.filter((arg): arg is string => typeof arg === "string");
  return readObjectConfig(args) as TypecheckArgs;
}

import { createServiceTask } from "../../runtime.js";
import { readObjectConfig, readVendorServiceConfig, unsupportedVendorResult } from "../../service-config.js";
import type { ServiceFactory } from "../../types.js";
import type { TypecheckArgs } from "./types.js";
import { oxcTypecheckVendor } from "./vendors/oxc.js";
import { tscTypecheckVendor } from "./vendors/tsc.js";

const vendors = {
  tsc: tscTypecheckVendor,
  oxc: oxcTypecheckVendor,
};

export const createTypecheckService: ServiceFactory = () => ({
  name: "typecheck",
  run(input, context) {
    const serviceConfig = readVendorServiceConfig(input.config, "tsc");
    const vendor = vendors[serviceConfig.vendor as keyof typeof vendors];
    if (!vendor) {
      return createServiceTask(async () => unsupportedVendorResult("typecheck", serviceConfig.vendor));
    }
    return vendor.run(
      {
        ...input,
        config: serviceConfig.config,
        args: readTypecheckArgs(input.args),
      },
      context
    );
  },
});

function readTypecheckArgs(args: unknown): TypecheckArgs | string[] | undefined {
  if (Array.isArray(args)) return args.filter((arg): arg is string => typeof arg === "string");
  return readObjectConfig(args) as TypecheckArgs;
}

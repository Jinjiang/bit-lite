import { createServiceTask } from "../../runtime.js";
import { loadServiceVendor, pipeVendorTask, readObjectConfig, readVendorServiceConfig } from "../../service-config.js";
import type { BitLiteService } from "../../types.js";
import type { TestArgs, TestVendor } from "./types.js";

export const testService: BitLiteService = {
  name: "test",
  run(input, context) {
    return createServiceTask(async (host) => {
      const serviceConfig = readVendorServiceConfig(input.config);
      const vendor = await loadServiceVendor<TestVendor>("test", serviceConfig.vendor, context);
      return pipeVendorTask(
        vendor.run(
          {
            ...input,
            config: serviceConfig.config,
            args: readTestArgs(input.args),
          },
          context
        ),
        host
      );
    });
  },
};

function readTestArgs(args: unknown): TestArgs {
  if (Array.isArray(args)) return parseTestCliArgs(args);
  return readObjectConfig(args) as TestArgs;
}

function parseTestCliArgs(args: unknown[]) {
  const parsed: TestArgs = {};
  for (const arg of args) {
    if (arg === "--watch") {
      parsed.watch = true;
      continue;
    }
    throw new Error(`unknown test argument "${String(arg)}"`);
  }
  return parsed;
}

import { createServiceTask } from "../../runtime.js";
import { loadServiceVendor, pipeVendorTask, readObjectConfig, readVendorServiceConfig } from "../../service-config.js";
import type { BitLiteService, ServiceTask } from "../../types/index.js";
import type { TestArgs, TestVendor } from "../../types/services/test.js";

export const testService: BitLiteService = {
  name: "test",
  run(input, context) {
    let vendorTask: ServiceTask | undefined;
    return createServiceTask(async (host) => {
      const serviceConfig = readVendorServiceConfig(input.config);
      const vendor = await loadServiceVendor<TestVendor>("test", serviceConfig.vendor, context);
      vendorTask = vendor.run(
        {
          ...input,
          config: serviceConfig.config,
          args: readTestArgs(input.args),
        },
        context
      );
      return pipeVendorTask(vendorTask, host);
    }, (type, payload) => {
      vendorTask?.call(type, payload);
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

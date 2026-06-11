import { createServiceTask } from "../../runtime.js";
import { readObjectConfig, readVendorServiceConfig, unsupportedVendorResult } from "../../service-config.js";
import type { ServiceFactory } from "../../types.js";
import type { TestArgs } from "./types.js";
import { jestTestVendor } from "./vendors/jest.js";
import { mochaTestVendor } from "./vendors/mocha.js";
import { vitestTestVendor } from "./vendors/vitest.js";

const vendors = {
  vitest: vitestTestVendor,
  jest: jestTestVendor,
  mocha: mochaTestVendor,
};

export const createTestService: ServiceFactory = () => ({
  name: "test",
  run(input, context) {
    const serviceConfig = readVendorServiceConfig(input.config, "vitest");
    const vendor = vendors[serviceConfig.vendor as keyof typeof vendors];
    if (!vendor) {
      return createServiceTask(async () => unsupportedVendorResult("test", serviceConfig.vendor));
    }
    return vendor.run(
      {
        ...input,
        config: serviceConfig.config,
        args: readTestArgs(input.args),
      },
      context
    );
  },
});

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

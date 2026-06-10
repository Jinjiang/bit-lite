import { builtinServiceDefinitions } from "./builtins.js";
import { BitLiteError } from "./errors.js";
import { runService } from "./runtime.js";
import type { ServiceCommandContext, ServiceCommandHandler, ServiceRunResult } from "./types.js";

const defaultServiceCommandHandler: ServiceCommandHandler = {
  async run({ workspace, serviceName, args }) {
    if (args.length > 0) {
      throw new BitLiteError(`service "${serviceName}" does not accept arguments: ${args.join(" ")}`);
    }
    return runService(workspace, serviceName);
  },
};

export function runServiceCommand(context: ServiceCommandContext): Promise<ServiceRunResult[]> {
  const handler = builtinServiceDefinitions[context.serviceName]?.command ?? defaultServiceCommandHandler;
  return handler.run(context);
}

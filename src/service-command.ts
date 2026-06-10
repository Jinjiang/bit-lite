import { BitLiteError } from "./errors.js";
import { runService } from "./runtime.js";
import { testCommandHandler } from "./test-command.js";
import type { ServiceRunResult } from "./runtime.js";
import type { WorkspaceRuntime } from "./types.js";

export type ServiceCommandContext = {
  workspace: WorkspaceRuntime;
  serviceName: string;
  args: string[];
};

export type ServiceCommandHandler = {
  run(context: ServiceCommandContext): Promise<ServiceRunResult[]>;
};

const serviceCommandHandlers: Record<string, ServiceCommandHandler> = {
  test: testCommandHandler,
};

const defaultServiceCommandHandler: ServiceCommandHandler = {
  async run({ workspace, serviceName, args }) {
    if (args.length > 0) {
      throw new BitLiteError(`service "${serviceName}" does not accept arguments: ${args.join(" ")}`);
    }
    return runService(workspace, serviceName);
  },
};

export function runServiceCommand(context: ServiceCommandContext): Promise<ServiceRunResult[]> {
  const handler = serviceCommandHandlers[context.serviceName] ?? defaultServiceCommandHandler;
  return handler.run(context);
}

import { builtinServiceDefinitions } from "./builtins.js";
import { BitLiteError } from "./errors.js";
import { runService } from "./runtime.js";
import type { ServiceCommandContext, ServiceCommandHandler, ServiceRunResult } from "./types.js";

const defaultServiceCommandHandler: ServiceCommandHandler = {
  async run({ workspace, serviceName, args }) {
    if (args.length > 0) {
      throw new BitLiteError(`service "${serviceName}" does not accept arguments: ${args.join(" ")}`);
    }
    return runService(workspace, serviceName, {
      onEvent: writeServiceEventToConsole,
    });
  },
};

export function runServiceCommand(context: ServiceCommandContext): Promise<ServiceRunResult[]> {
  const handler = builtinServiceDefinitions[context.serviceName]?.command ?? defaultServiceCommandHandler;
  return handler.run(context);
}

function writeServiceEventToConsole(type: string, payload: unknown) {
  if (type !== "output" || !isOutputPayload(payload)) return;
  const target = payload.stream === "stderr" ? process.stderr : process.stdout;
  target.write(payload.chunk);
}

function isOutputPayload(value: unknown): value is { stream: "stdout" | "stderr"; chunk: string } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { stream?: unknown; chunk?: unknown };
  return (candidate.stream === "stdout" || candidate.stream === "stderr") && typeof candidate.chunk === "string";
}

import type { RunnerShutdownMessage } from "bit-lite-runner";

export function isShutdownMessage(message: RunnerShutdownMessage) {
  return message.type === "shutdown";
}

export function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

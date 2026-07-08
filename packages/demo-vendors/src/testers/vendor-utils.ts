import type { RunnerShutdownMessage } from "bit-lite-vendors";

export function isShutdownMessage(message: unknown): message is RunnerShutdownMessage {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "shutdown";
}

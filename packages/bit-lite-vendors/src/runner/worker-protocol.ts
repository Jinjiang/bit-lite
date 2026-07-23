export const WORKER_RUNNER_START_RESULT_MESSAGE_TYPE = "bit-lite-vendors:runner:start-result" as const;
export const WORKER_RUNNER_SHUTDOWN_MESSAGE_TYPE = "bit-lite-vendors:runner:shutdown" as const;

export type WorkerRunnerShutdownMessage = {
  type: typeof WORKER_RUNNER_SHUTDOWN_MESSAGE_TYPE;
};

export function isWorkerRunnerShutdownMessage(
  message: unknown
): message is WorkerRunnerShutdownMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === WORKER_RUNNER_SHUTDOWN_MESSAGE_TYPE
  );
}

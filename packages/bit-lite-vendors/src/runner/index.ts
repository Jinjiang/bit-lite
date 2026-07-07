import { Worker } from "node:worker_threads";
import { bindTerminalResize, readTerminalSize } from "bit-lite-terminal";
import type { TerminalOutputStream, TerminalSize } from "bit-lite-terminal";
import { WORKER_RUNNER_START_RESULT_MESSAGE_TYPE } from "./worker-protocol.js";

export type RunnerMode = "worker" | "inline";

export type RunnerKind = RunnerMode;

export type RunnerExitCode = number | null | undefined;

export type RunnerOutputStream = TerminalOutputStream;

export type Unsubscribe = () => void;

export type RunnerShutdownMessage = {
  type: "shutdown";
};

export type RunnerParentMessage<Message = never> = Message | RunnerShutdownMessage;

export type RunnerMessageListener<Message> = (message: Message) => void;

export type RunnerParentMessageListener<Message = never> = (
  message: RunnerParentMessage<Message>
) => void | Promise<void>;

export type RunnerOutputListener = (stream: RunnerOutputStream, chunk: Buffer) => void;

export type RunnerRuntime<Data = unknown, ChildMessage = unknown, ParentMessage = never> = {
  data: Data;
  postMessage(message: ChildMessage): void;
  onMessage(listener: RunnerParentMessageListener<ParentMessage>): Unsubscribe;
};

export type RunnerStartResult<Data = unknown> = {
  data?: Data;
  stop?(): void | Promise<void>;
};

export type StartRunnerTarget<
  Data = unknown,
  ChildMessage = unknown,
  ParentMessage = never,
  ResultData = unknown,
> = (
  runtime: RunnerRuntime<Data, ChildMessage, ParentMessage>
) => void | RunnerStartResult<ResultData> | Promise<void | RunnerStartResult<ResultData>>;

export type RunnerTargetModule<
  Data = unknown,
  ChildMessage = unknown,
  ParentMessage = never,
  ResultData = unknown,
> = {
  default: StartRunnerTarget<Data, ChildMessage, ParentMessage, ResultData>;
};

export type RunnerTargetDefinition = {
  moduleUrl: URL | string;
};

export type WorkerRunnerData<Data = unknown> = {
  data: Data;
  moduleUrl: string;
  terminal: TerminalSize;
  emulateTty: boolean;
};

export type WorkerRunnerOptions = {
  bindResize?: boolean | undefined;
  emulateTty?: boolean | undefined;
  terminal?: TerminalSize | undefined;
};

export type CreateRunnerOptions<Data = unknown> = {
  mode: RunnerMode;
  target: RunnerTargetDefinition;
  data: Data;
  worker?: WorkerRunnerOptions | undefined;
};

export type Runner<Data = unknown, ChildMessage = unknown, ParentMessage = never, ResultData = unknown> = {
  kind: RunnerKind;
  exitPromise: Promise<RunnerExitCode>;
  onMessage(listener: RunnerMessageListener<ChildMessage>): Unsubscribe;
  onOutput(listener: RunnerOutputListener): Unsubscribe;
  postMessage(message: ParentMessage): void;
  send(message: RunnerParentMessage<ParentMessage>): void;
  writeInput(chunk: Buffer | string): void;
  start(): ResultData | undefined | Promise<ResultData | undefined>;
  stop(): void | Promise<void>;
  terminate(): void | Promise<void>;
};

export function createRunner<Data, ChildMessage = unknown, ParentMessage = never, ResultData = unknown>(
  options: CreateRunnerOptions<Data>
): Runner<Data, ChildMessage, ParentMessage, ResultData> {
  return options.mode === "worker"
    ? createWorkerRunner<Data, ChildMessage, ParentMessage, ResultData>(options.target, options.data, options.worker)
    : createInlineRunner<Data, ChildMessage, ParentMessage, ResultData>(options.target, options.data);
}

export function createInlineRunner<Data, ChildMessage = unknown, ParentMessage = never, ResultData = unknown>(
  target: RunnerTargetDefinition,
  data: Data
): Runner<Data, ChildMessage, ParentMessage, ResultData> {
  const parentMessageListeners = new Set<RunnerMessageListener<ChildMessage>>();
  const childMessageListeners = new Set<RunnerParentMessageListener<ParentMessage>>();
  let runnerStartResult: RunnerStartResult<ResultData> | void;
  let stopped = false;
  let resolveExit!: (code: RunnerExitCode) => void;

  const exitPromise = new Promise<RunnerExitCode>((resolve) => {
    resolveExit = resolve;
  });

  const runtime: RunnerRuntime<Data, ChildMessage, ParentMessage> = {
    data: structuredClone(data) as Data,
    postMessage(message) {
      const clonedMessage = structuredClone(message) as ChildMessage;
      for (const listener of parentMessageListeners) listener(clonedMessage);
    },
    onMessage(listener) {
      childMessageListeners.add(listener);
      return () => childMessageListeners.delete(listener);
    },
  };

  function sendToChild(message: RunnerParentMessage<ParentMessage>) {
    const clonedMessage = structuredClone(message) as RunnerParentMessage<ParentMessage>;
    for (const listener of childMessageListeners) listener(clonedMessage);
  }

  return {
    kind: "inline",
    exitPromise,
    onMessage(listener) {
      parentMessageListeners.add(listener);
      return () => parentMessageListeners.delete(listener);
    },
    onOutput(_listener) {
      return () => {};
    },
    postMessage(message) {
      sendToChild(message);
    },
    send(message) {
      sendToChild(message);
    },
    writeInput(_chunk) {},
    async start() {
      try {
        const runnerModule = (await import(toModuleUrl(target.moduleUrl))) as RunnerTargetModule<
          Data,
          ChildMessage,
          ParentMessage,
          ResultData
        >;
        const startRunnerTarget = runnerModule.default;

        if (typeof startRunnerTarget !== "function") {
          throw new Error("Runner target module must default export a StartRunnerTarget function.");
        }

        runnerStartResult = await startRunnerTarget(runtime);
        return runnerStartResult?.data;
      } catch (error) {
        runtime.postMessage({ type: "error", message: formatError(error) } as ChildMessage);
        console.error(error);
        resolveExit(1);
        return undefined;
      }
    },
    async stop() {
      if (stopped) return;
      stopped = true;

      sendToChild({ type: "shutdown" });
      await runnerStartResult?.stop?.();
      resolveExit(0);
    },
    async terminate() {
      await this.stop();
    },
  };
}

export function createWorkerRunner<Data, ChildMessage = unknown, ParentMessage = never, ResultData = unknown>(
  target: RunnerTargetDefinition,
  data: Data,
  options: WorkerRunnerOptions = {}
): Runner<Data, ChildMessage, ParentMessage, ResultData> {
  const outputListeners = new Set<RunnerOutputListener>();
  const messageListeners = new Set<RunnerMessageListener<ChildMessage>>();
  let worker: Worker | undefined;
  let unbindTerminalResize: Unsubscribe | undefined;
  let resolveExit!: (code: RunnerExitCode) => void;

  const exitPromise = new Promise<RunnerExitCode>((resolve) => {
    resolveExit = resolve;
  });

  return {
    kind: "worker",
    exitPromise,
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onOutput(listener) {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
    postMessage(message) {
      worker?.postMessage(message);
    },
    send(message) {
      worker?.postMessage(message);
    },
    writeInput(chunk) {
      worker?.stdin?.write(chunk);
    },
    start() {
      let startSettled = false;
      let resolveStart!: (data: ResultData | undefined) => void;
      let rejectStart!: (error: unknown) => void;
      const startPromise = new Promise<ResultData | undefined>((resolve, reject) => {
        resolveStart = resolve;
        rejectStart = reject;
      });
      const workerData: WorkerRunnerData<Data> = {
        data,
        moduleUrl: toModuleUrl(target.moduleUrl),
        terminal: options.terminal ?? readTerminalSize(),
        emulateTty: options.emulateTty ?? true,
      };

      worker = new Worker(createWorkerEntryUrl(), {
        workerData,
        stdout: true,
        stderr: true,
        stdin: true,
      });

      worker.stdout?.on("data", (chunk: Buffer) => emitOutput("stdout", chunk));
      worker.stderr?.on("data", (chunk: Buffer) => emitOutput("stderr", chunk));

      if (options.bindResize ?? workerData.emulateTty) {
        unbindTerminalResize = bindTerminalResize(worker);
      }

      worker.on("message", (message: ChildMessage | WorkerRunnerStartResultMessage<ResultData>) => {
        if (isWorkerRunnerStartResultMessage(message)) {
          startSettled = true;
          resolveStart(message.data);
          return;
        }

        for (const listener of messageListeners) listener(message);
      });
      worker.on("error", (error: Error) => {
        if (!startSettled) {
          startSettled = true;
          rejectStart(error);
        }

        for (const listener of messageListeners) {
          listener({ type: "error", message: error.stack ?? error.message } as ChildMessage);
        }
      });
      worker.once("exit", (code) => {
        unbindTerminalResize?.();
        unbindTerminalResize = undefined;
        if (!startSettled) {
          startSettled = true;
          rejectStart(new Error(`Runner worker exited before start completed with code ${formatExitCode(code)}`));
        }
        resolveExit(code);
      });

      return startPromise;
    },
    async stop() {
      this.send({ type: "shutdown" });
    },
    async terminate() {
      unbindTerminalResize?.();
      unbindTerminalResize = undefined;
      if (worker) await worker.terminate();
    },
  };

  function emitOutput(stream: RunnerOutputStream, chunk: Buffer) {
    for (const listener of outputListeners) listener(stream, chunk);
  }
}

type WorkerRunnerStartResultMessage<Data = unknown> = {
  type: typeof WORKER_RUNNER_START_RESULT_MESSAGE_TYPE;
  data?: Data;
};

function isWorkerRunnerStartResultMessage<Data>(message: unknown): message is WorkerRunnerStartResultMessage<Data> {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === WORKER_RUNNER_START_RESULT_MESSAGE_TYPE
  );
}

function createWorkerEntryUrl() {
  return new URL("./worker-entry.js", import.meta.url);
}

function toModuleUrl(moduleUrl: URL | string) {
  return moduleUrl instanceof URL ? moduleUrl.href : moduleUrl;
}

function formatExitCode(code: RunnerExitCode) {
  return typeof code === "number" ? String(code) : "unknown";
}

function formatError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

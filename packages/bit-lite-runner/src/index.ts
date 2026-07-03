import { Worker } from "node:worker_threads";
import { bindTerminalResize, readTerminalSize } from "bit-lite-terminal";
import type { TerminalOutputStream, TerminalSize } from "bit-lite-terminal";

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

export type RunnerParentMessageListener<Message> = (message: RunnerParentMessage<Message>) => void | Promise<void>;

export type RunnerOutputListener = (stream: RunnerOutputStream, chunk: Buffer) => void;

export type RunnerRuntime<Data = unknown, ChildMessage = unknown, ParentMessage = never> = {
  data: Data;
  postMessage(message: ChildMessage): void;
  onMessage(listener: RunnerParentMessageListener<ParentMessage>): Unsubscribe;
};

export type RunnerHandle = {
  stop?(): void | Promise<void>;
};

export type StartRunnerTarget<Data = unknown, ChildMessage = unknown, ParentMessage = never> = (
  runtime: RunnerRuntime<Data, ChildMessage, ParentMessage>
) => void | RunnerHandle | Promise<void | RunnerHandle>;

export type RunnerTargetModule<Data = unknown, ChildMessage = unknown, ParentMessage = never> = {
  default: StartRunnerTarget<Data, ChildMessage, ParentMessage>;
};

export type RunnerTargetDefinition = {
  moduleUrl: URL | string;
};

export type WorkerRunnerData<Data = unknown> = {
  data: Data;
  moduleUrl: string;
  terminalApiUrl: string;
  terminal: TerminalSize;
  emulateTty: boolean;
  tsxApiUrl: string;
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

export type Runner<Data = unknown, ChildMessage = unknown, ParentMessage = never> = {
  kind: RunnerKind;
  exitPromise: Promise<RunnerExitCode>;
  onMessage(listener: RunnerMessageListener<ChildMessage>): Unsubscribe;
  onOutput(listener: RunnerOutputListener): Unsubscribe;
  send(message: RunnerParentMessage<ParentMessage>): void;
  writeInput(chunk: Buffer | string): void;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  terminate(): void | Promise<void>;
};

export function createRunner<Data, ChildMessage = unknown, ParentMessage = never>(
  options: CreateRunnerOptions<Data>
): Runner<Data, ChildMessage, ParentMessage> {
  return options.mode === "worker"
    ? createWorkerRunner<Data, ChildMessage, ParentMessage>(options.target, options.data, options.worker)
    : createInlineRunner<Data, ChildMessage, ParentMessage>(options.target, options.data);
}

export function createInlineRunner<Data, ChildMessage = unknown, ParentMessage = never>(
  target: RunnerTargetDefinition,
  data: Data
): Runner<Data, ChildMessage, ParentMessage> {
  const parentMessageListeners = new Set<RunnerMessageListener<ChildMessage>>();
  const childMessageListeners = new Set<RunnerParentMessageListener<ParentMessage>>();
  let runnerHandle: RunnerHandle | void;
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
    send(message) {
      sendToChild(message);
    },
    writeInput(_chunk) {},
    async start() {
      try {
        const runnerModule = (await import(toModuleUrl(target.moduleUrl))) as RunnerTargetModule<
          Data,
          ChildMessage,
          ParentMessage
        >;
        const startRunnerTarget = runnerModule.default;

        if (typeof startRunnerTarget !== "function") {
          throw new Error("Runner target module must default export a StartRunnerTarget function.");
        }

        runnerHandle = await startRunnerTarget(runtime);
      } catch (error) {
        runtime.postMessage({ type: "error", message: formatError(error) } as ChildMessage);
        console.error(error);
        resolveExit(1);
      }
    },
    async stop() {
      if (stopped) return;
      stopped = true;

      sendToChild({ type: "shutdown" });
      await runnerHandle?.stop?.();
      resolveExit(0);
    },
    async terminate() {
      await this.stop();
    },
  };
}

export function createWorkerRunner<Data, ChildMessage = unknown, ParentMessage = never>(
  target: RunnerTargetDefinition,
  data: Data,
  options: WorkerRunnerOptions = {}
): Runner<Data, ChildMessage, ParentMessage> {
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
    send(message) {
      worker?.postMessage(message);
    },
    writeInput(chunk) {
      worker?.stdin?.write(chunk);
    },
    start() {
      const workerData: WorkerRunnerData<Data> = {
        data,
        moduleUrl: toModuleUrl(target.moduleUrl),
        terminalApiUrl: import.meta.resolve("bit-lite-terminal"),
        terminal: options.terminal ?? readTerminalSize(),
        emulateTty: options.emulateTty ?? true,
        tsxApiUrl: import.meta.resolve("tsx/esm/api"),
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

      worker.on("message", (message: ChildMessage) => {
        for (const listener of messageListeners) listener(message);
      });
      worker.on("error", (error: Error) => {
        for (const listener of messageListeners) {
          listener({ type: "error", message: error.stack ?? error.message } as ChildMessage);
        }
      });
      worker.once("exit", (code) => {
        unbindTerminalResize?.();
        unbindTerminalResize = undefined;
        resolveExit(code);
      });
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

function createWorkerEntryUrl() {
  return new URL(`data:text/javascript,${encodeURIComponent(workerEntrySource)}`);
}

function toModuleUrl(moduleUrl: URL | string) {
  return moduleUrl instanceof URL ? moduleUrl.href : moduleUrl;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

const workerEntrySource = String.raw`
import { parentPort, workerData } from "node:worker_threads";

const parentMessageListeners = new Set();
let runnerHandle;
let terminalApi;
const { tsImport } = await import(workerData.tsxApiUrl);

if (workerData.emulateTty) {
  terminalApi = await tsImport(workerData.terminalApiUrl, {
    parentURL: workerData.terminalApiUrl,
  });
  terminalApi.installWorkerTtyShim({ terminal: workerData.terminal });
}

const runtime = {
  data: workerData.data,
  postMessage(message) {
    parentPort?.postMessage(message);
  },
  onMessage(listener) {
    parentMessageListeners.add(listener);
    return () => parentMessageListeners.delete(listener);
  },
};

parentPort?.on("message", async (message) => {
  if (terminalApi?.isTerminalResizeMessage(message)) {
    terminalApi.setTerminalSize(message);
    return;
  }

  for (const listener of parentMessageListeners) await listener(message);

  if (message?.type === "shutdown") {
    await runnerHandle?.stop?.();
    process.exit(0);
  }
});

try {
  const runnerModule = await tsImport(workerData.moduleUrl, {
    parentURL: workerData.moduleUrl,
  });
  const startRunnerTarget = runnerModule.default;

  if (typeof startRunnerTarget !== "function") {
    throw new Error("Runner target module must default export a StartRunnerTarget function.");
  }

  runnerHandle = await startRunnerTarget(runtime);
} catch (error) {
  runtime.postMessage({ type: "error", message: error.stack ?? error.message });
  console.error(error);
  process.exit(1);
}
`;

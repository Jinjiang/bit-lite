import chokidar from "chokidar";
import type {
  CompileOutput,
  CompileRunResult,
  CompileVendorInput,
  CompileWatchResult,
  CompilerVendorRuntime,
} from "bit-lite-compiler";
import type {
  VendorStartResult,
} from "bit-lite-vendors";

type CompileOperation = (input: CompileVendorInput) => Promise<CompileOutput>;

export async function startCompilerWatch(
  runtime: CompilerVendorRuntime,
  compileOnce: CompileOperation
): Promise<VendorStartResult<CompileRunResult>> {
  if (runtime.data.context.args.options.watch !== true) {
    throw new Error("Compiler task runner requires context.args.options.watch to be true");
  }
  const component = runtime.data.components[0];
  if (!component || runtime.data.components.length !== 1 || !runtime.data.runtime) {
    throw new Error("Compiler watch requires exactly one component and compile runtime");
  }

  let stopped = false;
  let stopping: Promise<void> | undefined;
  let running: Promise<void> | undefined;
  let queued = false;
  let run = 0;
  const watcher = chokidar.watch(component.rootDir, {
    ignoreInitial: true,
    ignored: (watchedPath) => isIgnoredPath(watchedPath, component.rootDir),
  });

  const unsubscribe = runtime.onMessage((message) => {
    if (isShutdownMessage(message)) void stop();
  });
  watcher.on("all", () => queueCompile());
  watcher.on("error", (error) => {
    runtime.postMessage({ type: "error", message: formatError(error) });
  });
  await new Promise<void>((resolve, reject) => {
    watcher.once("ready", resolve);
    watcher.once("error", reject);
  });
  runtime.postMessage({ type: "ready" });
  await queueCompile();

  return { stop };

  function queueCompile() {
    if (stopped) return Promise.resolve();
    queued = true;
    if (!running) {
      const active = drainQueue();
      running = active;
      void active.finally(() => {
        if (running === active) running = undefined;
        if (queued && !stopped) void queueCompile();
      });
    }
    return running;
  }

  async function drainQueue() {
    while (queued && !stopped) {
      queued = false;
      runtime.postMessage({ type: "status", status: "compiling" });
      try {
        const output = await compileOnce(runtime.data as CompileVendorInput);
        run += 1;
        const data: CompileWatchResult = {
          run,
          output: output === undefined ? null : output,
        };
        runtime.postMessage({ type: "result", data });
        runtime.postMessage({ type: "status", status: "watching" });
      } catch (error) {
        runtime.postMessage({ type: "error", message: formatError(error) });
      }
    }
  }

  async function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      if (stopped) return;
      stopped = true;
      queued = false;
      await watcher.close();
      await running?.catch(() => undefined);
      unsubscribe();
      runtime.postMessage({ type: "status", status: "stopped" });
    })();
    return stopping;
  }
}

function isIgnoredPath(watchedPath: string, rootDir: string) {
  const relative = watchedPath.slice(rootDir.length).replaceAll("\\", "/");
  return relative.split("/").some((segment) =>
    segment === "node_modules" || segment === "dist" || segment === ".git" || segment === ".bit-lite"
  );
}

function isShutdownMessage(value: unknown) {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "shutdown";
}

function formatError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

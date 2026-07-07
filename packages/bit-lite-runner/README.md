# bit-lite-runner

Reusable Node.js runners for integration tools that can run either inline in the
parent process or inside a `worker_threads` Worker.

Target modules are loaded with standard Node.js ESM `import()`, so pass a URL to
compiled JavaScript. TypeScript targets should be compiled to `dist` before the
runner starts.

The package defines a small runtime contract:

- the parent passes serializable `data` to the target module
- the target sends structured messages with `runtime.postMessage()`
- the parent sends control messages with `runner.send()`
- the target can return immediate data through `RunnerStartResult.data`
- `runner.stop()` sends the standard `{ type: "shutdown" }` message
- worker mode proxies stdout/stderr and can forward stdin to the worker

## Usage

```ts
import { createRunner } from "bit-lite-runner";
import type { RunnerRuntime } from "bit-lite-runner";

type Data = {
  label: string;
};

type ChildMessage = {
  type: "ready";
};

const runner = createRunner<Data, ChildMessage>({
  mode: "worker",
  target: {
    moduleUrl: new URL("./tool.js", import.meta.url),
  },
  data: {
    label: "Example Tool",
  },
});

runner.onMessage((message) => {
  if (message.type === "ready") {
    console.log("tool is ready");
  }
});

runner.onOutput((stream, chunk) => {
  const target = stream === "stderr" ? process.stderr : process.stdout;
  target.write(chunk);
});

const data = await runner.start();
if (data !== undefined) {
  console.log("tool returned data", data);
}
```

The target module default-exports a `StartRunnerTarget` function:

```ts
import type { RunnerStartResult, RunnerRuntime } from "bit-lite-runner";

type Data = {
  label: string;
};

type ChildMessage = {
  type: "ready";
};

export default async function startTool(runtime: RunnerRuntime<Data, ChildMessage>): Promise<RunnerStartResult> {
  console.log(`Starting ${runtime.data.label}`);
  runtime.postMessage({ type: "ready" });

  return {
    async stop() {
      console.log("Stopping tool");
    },
  };
}
```

One-shot targets can return data directly instead of sending a result message:

```ts
export default async function runTool(runtime: RunnerRuntime<Data>): Promise<RunnerStartResult<{ ok: true }>> {
  return {
    data: { ok: true },
  };
}
```

## API

### `createRunner(options)`

Creates either an inline runner or a worker runner based on `options.mode`.

```ts
createRunner({
  mode: "worker",
  target: { moduleUrl },
  data,
});
```

### `createInlineRunner(target, data)`

Imports the target module in the parent process. Stdout/stderr are not proxied,
because the target writes to the parent process streams directly.

### `createWorkerRunner(target, data, options?)`

Starts the target module inside a Worker. Worker stdout/stderr are emitted
through `runner.onOutput()`, and `runner.writeInput()` forwards input to worker
stdin.

By default worker mode installs the `bit-lite-terminal` TTY shim and forwards
terminal resize messages. This can be controlled with:

```ts
createWorkerRunner(target, data, {
  emulateTty: true,
  bindResize: true,
});
```

Build and type check the package with:

```sh
pnpm --filter bit-lite-runner build
pnpm --filter bit-lite-runner typecheck
```

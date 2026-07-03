# bit-lite-terminal

Small Node.js terminal helpers for running CLI-like integrations inside
`worker_threads`.

The package focuses on one common worker-runner problem: when a tool runs inside
a Worker with `stdout: true` and `stderr: true`, those streams are no longer real
TTY streams. Many dev tools then disable colors, clear-screen output, progress
UI, terminal sizing, or raw input handling. `bit-lite-terminal` provides a small
shim for the worker side plus helpers for the parent process to forward output
and terminal resize events.

## Usage

Add the workspace dependency from another package:

```json
{
  "dependencies": {
    "bit-lite-terminal": "workspace:*"
  }
}
```

In the parent process, pass the current terminal size to the worker, proxy the
worker output back to the real terminal, and forward resize events:

```ts
import { Worker } from "node:worker_threads";
import {
  bindTerminalResize,
  readTerminalSize,
  writeTerminalOutput,
} from "bit-lite-terminal";

const worker = new Worker(new URL("./worker.js", import.meta.url), {
  workerData: {
    terminal: readTerminalSize(),
  },
  stdout: true,
  stderr: true,
  stdin: true,
});

const unbindTerminalResize = bindTerminalResize(worker);

worker.stdout?.on("data", (chunk: Buffer) => {
  writeTerminalOutput("stdout", chunk);
});

worker.stderr?.on("data", (chunk: Buffer) => {
  writeTerminalOutput("stderr", chunk);
});

worker.once("exit", () => {
  unbindTerminalResize();
});
```

In the worker, install the TTY shim before starting the integration:

```ts
import { parentPort, workerData } from "node:worker_threads";
import {
  installWorkerTtyShim,
  isTerminalResizeMessage,
  setTerminalSize,
} from "bit-lite-terminal";

installWorkerTtyShim({ terminal: workerData.terminal });

parentPort?.on("message", (message) => {
  if (isTerminalResizeMessage(message)) {
    setTerminalSize(message);
    return;
  }
});

// Start the tool that expects a TTY here.
```

## API

### `installWorkerTtyShim(options?)`

Installs terminal-like behavior on the worker process streams:

- marks `process.stdout`, `process.stderr`, and `process.stdin` as TTY streams
- sets `columns` and `rows` on stdout/stderr
- adds common cursor and clear-screen helpers backed by `node:readline`
- adds `stdin.setRawMode()` when missing
- defaults `TERM` to `xterm-256color`
- enables color output with `FORCE_COLOR=1` unless `forceColor: false` is passed

Use this as early as possible in the worker entry, before importing or starting
the tool that probes terminal capabilities.

```ts
installWorkerTtyShim({
  terminal: { columns: 120, rows: 40 },
  forceColor: true,
  term: "xterm-256color",
});
```

### `readTerminalSize(stream?)`

Reads the current terminal dimensions from a write stream and returns validated
positive integers. Defaults to `process.stdout`. Missing or invalid dimensions
fall back to `80x24`.

```ts
const terminal = readTerminalSize();
```

### `setTerminalSize(terminal?)`

Updates `process.stdout` and `process.stderr` with a terminal size. This is used
inside workers when the parent process sends a resize message.

```ts
setTerminalSize({ columns: 100, rows: 30 });
```

### `createTerminalResizeMessage(terminal?)`

Creates a serializable resize message:

```ts
const message = createTerminalResizeMessage({ columns: 100, rows: 30 });
```

The message shape is:

```ts
{
  type: "terminal:resize",
  columns?: number,
  rows?: number,
}
```

### `isTerminalResizeMessage(message)`

Type guard for messages created by `createTerminalResizeMessage()`.

```ts
if (isTerminalResizeMessage(message)) {
  setTerminalSize(message);
}
```

### `bindTerminalResize(target, stream?)`

Subscribes to the parent terminal's `resize` event and posts resize messages to
the target. The target only needs a `postMessage()` method, so a `Worker` can be
passed directly. Returns an unsubscribe function.

```ts
const unbind = bindTerminalResize(worker);

worker.once("exit", () => {
  unbind();
});
```

### `writeTerminalOutput(stream, chunk)`

Writes a raw output chunk to the matching process stream.

```ts
writeTerminalOutput("stdout", chunk);
writeTerminalOutput("stderr", chunk);
```

### `RawOutputBuffer`

Stores raw stdout/stderr chunks with a byte limit. This is useful for interactive
managers that run multiple workers, keep recent output for each one, and replay
the selected worker's output when attaching the terminal to it.

```ts
const output = new RawOutputBuffer({ limitBytes: 2_000_000 });

output.append("stdout", chunk);

for (const entry of output.entries()) {
  writeTerminalOutput(entry.stream, entry.chunk);
}
```

When the buffer grows past `limitBytes`, the oldest chunks are dropped.

## Examples in this repository

- `packages/demo-vite-worker` uses the shim to compare direct Vite output with
  worker-proxied output.
- `packages/demo-integrations` uses the helpers to run multiple integrations in
  worker mode, buffer their raw output, and attach the terminal to one selected
  integration at a time.

Run the package type check with:

```sh
pnpm --filter bit-lite-terminal typecheck
```

# bit-lite-terminal

Small Node.js terminal helpers for running CLI-like integrations inside
`worker_threads`.

The package focuses on two related problems:

- when a tool runs inside a Worker with `stdout: true` and `stderr: true`, those
  streams are no longer real TTY streams
- when multiple child terminals are running at once, the parent terminal needs a
  menu, output buffers, and an attach/detach flow for forwarding input

Many dev tools disable colors, clear-screen output, progress UI, terminal
sizing, or raw input handling when they do not see a TTY. `bit-lite-terminal`
provides a small shim for the worker side plus helpers for the parent process to
forward output and terminal resize events.

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

### `ManagedTerminal`

Runs a small parent terminal UI for multiple child terminals. It renders a menu,
tracks the selected item, buffers stdout/stderr per item, replays buffered output
when attaching to one child terminal, and forwards key input to the attached
item's `writeInput()` callback.

Use it when a parent process owns several long-running integrations and needs to
show one compact status screen while preserving access to each child's raw
terminal output. `ManagedTerminal` does not start, stop, or supervise child
processes itself. The caller owns those processes and connects their output,
input, status, and shutdown handling to the terminal manager.

```ts
import { ManagedTerminal, RawOutputBuffer } from "bit-lite-terminal";

const item = {
  id: "vite",
  label: "Vite Dev Server",
  status: "starting",
  hint: "Node API: vite.createServer",
  details: [],
  rawOutput: new RawOutputBuffer(),
  writeInput(chunk: Buffer | string) {
    worker.stdin?.write(chunk);
  },
};

const terminal = new ManagedTerminal({
  title: "integrations",
  items: [item],
  onQuit() {
    void shutdown();
  },
});

terminal.start();

worker.stdout?.on("data", (chunk: Buffer) => {
  terminal.appendOutput(item, "stdout", chunk);
});

worker.stderr?.on("data", (chunk: Buffer) => {
  terminal.appendOutput(item, "stderr", chunk);
});

item.status = "ready";
terminal.scheduleRender();
```

Press Enter from the menu to attach to a child terminal, Escape to return to the
menu, and `q` or Ctrl+C to call `onQuit()`.

#### Item shape

Each managed item is mutable state owned by the caller:

```ts
type ManagedTerminalItem = {
  id: string;
  label: string;
  status: string;
  hint?: string;
  details?: string[];
  rawOutput: RawOutputBuffer;
  writeInput?(chunk: Buffer | string): void;
  canAttach?: boolean;
};
```

The menu renders `label`, `status`, optional `hint`, and optional `details`.
`details` is a list of caller-formatted text fragments shown after the static
hint. The terminal manager does not interpret those values; callers can derive
them from any higher-level result message or domain-specific state.

`rawOutput` stores recent stdout/stderr chunks. When the user attaches to an
item, the buffer is replayed before new output is passed through live.

`writeInput()` is called only while an item is attached. Use it to forward typed
keys to a Worker, child process, pty, or any other terminal-like backend.

`canAttach` controls whether Enter can open an item. If omitted, attach is
enabled when `writeInput()` exists. You can also centralize the decision with the
constructor-level `canAttach(item)` option.

#### Options

```ts
const terminal = new ManagedTerminal({
  title: () => "integrations",
  items,
  instructions: "Use Up/Down and Enter. Press q to quit.",
  labelWidth: 24,
  statusWidth: 12,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  canAttach(item) {
    return item.status !== "starting";
  },
  onQuit(reason) {
    void shutdown(reason);
  },
});
```

- `title` can be a string or callback. The callback form is useful when the menu
  title includes mutable state such as a selected runner mode.
- `items` is the live list rendered in the menu. Mutate item fields and call
  `scheduleRender()` after status changes.
- `instructions` overrides the default help line.
- `labelWidth` and `statusWidth` control fixed-width menu columns.
- `stdin`, `stdout`, and `stderr` default to the current process streams. Pass
  custom streams for tests or embedding.
- `canAttach(item)` overrides per-item attach behavior.
- `onQuit(reason)` receives `"quit"` for `q` and `"ctrl-c"` for Ctrl+C.

#### Lifecycle

```ts
terminal.start();
terminal.scheduleRender();
terminal.renderNow();
terminal.stop({ clearScreen: true });
```

`start()` enables keypress handling, puts stdin into raw mode when supported, and
schedules the first render. It is safe to call more than once.

`scheduleRender()` batches menu redraws with `setImmediate()`. It does nothing
while a raw child terminal is attached, so child output is not overwritten by
menu redraws.

`renderNow()` redraws the menu immediately. Most callers should prefer
`scheduleRender()` after changing item state.

`stop()` removes the keypress listener, leaves raw mode when supported, and shows
the cursor. Pass `{ clearScreen: true }` during shutdown if the parent process
should leave a clean terminal behind.

#### Output

```ts
terminal.appendOutput(item, "stdout", chunk);
terminal.appendOutput(item.id, "stderr", chunk);
```

`appendOutput()` records the chunk in the item's `RawOutputBuffer`. If that item
is currently attached, the same chunk is also written immediately to the managed
stdout or stderr stream. Passing an unknown item id is ignored.

For a typical Worker-backed integration:

```ts
const item = {
  id: "webpack",
  label: "Webpack Dev Server",
  status: "starting",
  details: [],
  rawOutput: new RawOutputBuffer(),
  writeInput(chunk: Buffer | string) {
    worker.stdin?.write(chunk);
  },
};

const terminal = new ManagedTerminal({
  title: () => `integrations (${runnerMode})`,
  items: [item],
  onQuit(reason) {
    void shutdown(reason);
  },
});

worker.stdout?.on("data", (chunk: Buffer) => {
  terminal.appendOutput(item, "stdout", chunk);
});

worker.stderr?.on("data", (chunk: Buffer) => {
  terminal.appendOutput(item, "stderr", chunk);
});

worker.on("message", (message) => {
  if (message.type === "result" && message.data.kind === "dev-server") {
    item.details = [message.data.url];
    terminal.scheduleRender();
  }

  if (message.type === "ready") {
    item.status = "ready";
    terminal.scheduleRender();
  }
});

terminal.start();
```

#### State Getters

- `terminal.screen` is `"menu"` or `"terminal"`.
- `terminal.selectedItem` is the currently highlighted menu item, or `undefined`
  when the item list is empty.
- `terminal.activeItem` is the attached item while a child terminal is open.

These are read-only convenience getters. Navigation, attach, and detach are
driven by keyboard input.

## Examples in this repository

- `packages/demo-vite-worker` uses the shim to compare direct Vite output with
  worker-proxied output.
- `packages/demo-integrations` uses the helpers to run multiple integrations in
  worker mode, buffer their raw output, and attach the terminal to one selected
  integration at a time.

Build and type check the package with:

```sh
pnpm --filter bit-lite-terminal build
pnpm --filter bit-lite-terminal typecheck
```

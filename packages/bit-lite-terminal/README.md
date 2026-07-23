# bit-lite-terminal

`bit-lite-terminal` implements the interactive terminal used to supervise long-running vendor tasks.

It also provides the TTY bridge needed when a vendor runs in a Node.js worker thread.

## Managed task screen

Each `ManagedTerminalItem` supplies display state, buffered output, and optionally an input writer:

```ts
import {
  ManagedTerminal,
  RawOutputBuffer,
} from "bit-lite-terminal";

const task = {
  id: "test",
  label: "Tests",
  status: "starting",
  hint: "waiting for first run",
  rawOutput: new RawOutputBuffer(),
};

const terminal = new ManagedTerminal({
  title: "Workspace tasks",
  items: [task],
  instructions: "Select a task to view its output.",
});

terminal.start();
terminal.appendOutput(task, "stdout", "ready\n");
```

The screen can switch between a summary menu and the raw output of an attached task. It handles navigation, input forwarding, redraws, and interrupts.

## Output retention

`RawOutputBuffer` stores stdout and stderr chunks in order. Set `limitBytes` to bound memory use for long sessions.

## Worker TTY support

Worker threads do not inherit a complete terminal environment. These helpers reproduce the required behavior:

- `installWorkerTtyShim`: installs TTY-like properties and output handling in the worker.
- `readTerminalSize`: reads the parent terminal dimensions.
- `bindTerminalResize`: sends resize messages to a worker.
- `isTerminalResizeMessage` and `setTerminalSize`: validate and apply those messages.
- `writeTerminalOutput`: write a worker output chunk to the selected parent stream.

In non-interactive environments, callers can skip `ManagedTerminal` and consume vendor state and output directly.

## Package development

```bash
pnpm --filter bit-lite-terminal build
pnpm --filter bit-lite-terminal typecheck
pnpm --filter bit-lite-terminal test
```

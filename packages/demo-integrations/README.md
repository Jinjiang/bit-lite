# demo-integrations

Standalone TypeScript demo for running several JavaScript tool integrations through Node APIs with a switchable execution runner.

The reusable pieces live outside the demo:

- `bit-lite-runner` provides the inline and Worker Thread runners.
- `bit-lite-terminal` provides the parent menu, child terminal attach/detach,
  output buffering, and worker TTY helpers.

Vendors report lifecycle messages and structured `result` data. The demo's main
process interprets those results and turns them into menu `details`, keeping the
terminal UI generic.

```sh
pnpm --filter demo-integrations start
```

The start scripts compile the demo to `dist` first, then run the compiled
JavaScript with Node.js.

Use the arrow keys to select a vendor. In worker mode, press Enter to attach the terminal to the selected vendor's raw output, then press Escape to return to the vendor menu. Press `q` or `Ctrl+C` to stop the demo from the menu.

By default the demo uses the Worker Thread runner:

```sh
pnpm --filter demo-integrations start:worker
```

Inline mode imports and runs the same vendor modules directly in the parent process. In this mode vendor stdout/stderr are not proxied, so tool output is written directly to the terminal:

```sh
pnpm --filter demo-integrations start:inline
```

For building and type checking:

```sh
pnpm --filter demo-integrations build
pnpm --filter demo-integrations typecheck
```

For a short interactive run, set `DEMO_INTEGRATIONS_AUTO_EXIT_MS` before starting the demo.

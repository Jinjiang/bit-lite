# demo-integrations

Standalone TypeScript demo for running several JavaScript tool integrations through Node APIs with a switchable execution runner.

```sh
pnpm --filter demo-integrations start
```

Use the arrow keys to select a vendor. In worker mode, press Enter to attach the terminal to the selected vendor's raw output, then press Escape to return to the vendor menu. Press `q` or `Ctrl+C` to stop the demo from the menu.

By default the demo uses the Worker Thread runner:

```sh
pnpm --filter demo-integrations start:worker
```

Inline mode imports and runs the same vendor modules directly in the parent process. In this mode vendor stdout/stderr are not proxied, so tool output is written directly to the terminal:

```sh
pnpm --filter demo-integrations start:inline
```

For type checking:

```sh
pnpm --filter demo-integrations typecheck
```

For a short interactive run, set `DEMO_INTEGRATIONS_AUTO_EXIT_MS` before starting the demo.

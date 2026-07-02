# demo-integrations

Standalone TypeScript demo for running several JavaScript tool integrations through Node APIs with a switchable execution runner.

```sh
pnpm --filter demo-integrations start
```

Use the arrow keys and Enter to open a service output. Press Escape to return to the service menu. Press `q` or `Ctrl+C` to stop the demo.

By default the demo uses the Worker Thread runner:

```sh
pnpm --filter demo-integrations start:worker
```

Inline mode imports and runs the same service modules directly in the parent process. In this mode service stdout/stderr are not proxied, so tool output is written directly to the terminal:

```sh
pnpm --filter demo-integrations start:inline
```

For non-interactive verification:

```sh
pnpm --filter demo-integrations smoke
pnpm --filter demo-integrations smoke:inline
pnpm --filter demo-integrations typecheck
```

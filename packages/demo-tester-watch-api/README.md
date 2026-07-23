# demo-tester-watch-api

Small research demo for embedding Jest and Vitest watch mode in worker threads.

It starts two workers:

- `jest`: runs Jest native watch mode through `runCLI({ watchAll: true })`
- `vitest`: runs Vitest native watch mode through `createVitest({ watch: true })`

The parent process wraps both workers with `bit-lite-terminal`. Each worker keeps
its native/default reporter enabled, so attaching to a worker from the terminal
menu shows the original Jest or Vitest watch output.

Run:

```sh
pnpm --filter demo-tester-watch-api demo
```

This package intentionally resolves the already-installed Jest and Vitest copies
from the sibling `demo-vendors` package, so it does not add new lockfile
dependencies.

In parallel with native terminal output, each worker sends a result event to the
parent on every rerun:

- `json`: structured run data
- `text`: readable output similar to terminal test output

The parent keeps those result events outside the worker terminals and exposes
them through an HTTP server shown in the menu title:

- `/jest/results.json`
- `/jest/results.txt`
- `/vitest/results.json`
- `/vitest/results.txt`

By default the server listens on `http://127.0.0.1:3000`. Set
`DEMO_TESTER_WATCH_API_PORT` to override it.

The JSON endpoints return an array of all historical results. The text endpoints
return historical text reports separated by a line containing `---`.

Use Up/Down and Enter in the parent menu to attach to a worker terminal. In the
attached terminal, key input is forwarded to that worker's stdin. Press Escape to
return to the parent menu.

Press Ctrl+C in the parent menu to send `SIGINT` to the parent process. Pressing
`q` in the parent menu leaves the session active. While attached, ordinary keys
are forwarded to the selected native Jest or Vitest terminal.

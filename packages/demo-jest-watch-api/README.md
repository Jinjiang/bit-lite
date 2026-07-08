# demo-jest-watch-api

Small research demo for Jest watch mode embedding.

It demonstrates three findings from Jest 30.4.x:

- `runCLI({ watch/watchAll: true })` starts native watch mode and does not resolve.
- A custom reporter can observe `onRunComplete`, but this hook runs before Jest assigns the final `AggregatedResult.success` value.
- A watch plugin can observe `jestHooks.onTestRunComplete` after Jest processes results, so it is the better bridge for per-run watch results.

Run:

```sh
pnpm --filter demo-jest-watch-api demo
pnpm --filter demo-jest-watch-api demo:results
pnpm --filter demo-jest-watch-api demo:native-watch
pnpm --filter demo-jest-watch-api demo:workers
pnpm --filter demo-jest-watch-api demo:exit
```

This package intentionally resolves the already-installed Jest copy from the sibling `demo-vendors` package, so it does not add new lockfile dependencies.

The reporter probe keeps Jest's default reporter/UI and appends each observed result to `/private/tmp/demo-jest-watch-api/reporter-results.json`. It also appends a readable text report to `/private/tmp/demo-jest-watch-api/reporter-results.txt`, using `---` between runs. The output files are outside Jest's `rootDir`, and the demo also ignores `results/`, so writing results will not retrigger watch mode. It intentionally keeps Jest watch mode alive; exit with Jest's native watch controls such as `q` or `Ctrl+C`.

The watch-plugin probe still prints observed results to stdout and suppresses reporters with `reporters: []`, so it is useful when you want a quiet result-channel probe.

`demo:native-watch` passes no custom reporter and no watch plugin, so it shows plain Jest watch mode with Jest's default reporter/UI.

`demo:workers` starts two worker threads, one for Jest watch mode and one for Vitest watch mode, then wraps them with a small `bit-lite-terminal` menu. Each worker keeps its native/default reporter enabled, so attaching to a worker from the terminal menu shows the original Jest or Vitest watch output.

In parallel, each worker sends a result event to the parent on every rerun:

- `json`: structured run data
- `text`: readable output similar to terminal test output

The parent keeps those result events outside the worker terminals and exposes them through an HTTP server shown in the menu title:

- `/jest/results.json`
- `/jest/results.txt`
- `/vitest/results.json`
- `/vitest/results.txt`

By default the server listens on `http://127.0.0.1:3000`. Set `DEMO_JEST_WATCH_API_PORT` to override it.

The JSON endpoints return an array of all historical results. The text endpoints return historical text reports separated by a line containing `---`.

Press `q` or `Ctrl+C` in the parent menu to send shutdown to both workers. Vitest closes through `vitest.close()`. Jest does not expose a public watch close handle, so this demo stops the Jest worker at the worker boundary after sending shutdown.

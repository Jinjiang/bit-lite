# Demo Services

This package is an isolated experiment for service vendors that can power lint, test, and compile flows.

Each vendor has:

- a small target source file under `targets/`
- a runner under `runners/`
- normalized TypeScript result types in `src/types/service-results.ts`

Run everything:

```sh
pnpm run
```

Run one service group:

```sh
pnpm run:lint
pnpm run:test
pnpm run:compile
```

Outputs are printed as JSON and written to `results/*.json`. Generated artifacts are written to `results/artifacts`.

The demo intentionally distinguishes `js-api` and `cli-json`. Some vendors do not expose a stable public execution API, but they can still produce structured JSON without parsing human terminal output.

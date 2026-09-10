# bit-lite-tester

`bit-lite-tester` is a contract package for test vendors. It gives the CLI and vendor implementations a common set of result and runtime types.

The package runs no tests itself.

## Contract

A test vendor receives the components selected for one env group together with the standard vendor context, and reports results over the vendor message channel.

```ts
type TestStats = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  summary: string;
};

type TestComponentResult = {
  componentId: string;
  files: string[];
  stats: TestStats;
  durationMs: number;
  errors: string[];
};

type TestServiceResult = {
  mode: "run" | "watch";
  run: number;
  stats: TestStats;
  componentResults: TestComponentResult[];
  coverage?: JsonValue;
};
```

`run` counts from 1 and increases for each watch-mode re-run, so a consumer can tell a repeated result from the first one. `summary` travels with the counts so every consumer renders the same phrase instead of reformatting the numbers. A result may carry additional JSON fields; the guards check the fields the protocol names and pass the rest through.

## Writing a test vendor

```ts
import type { TesterVendorRuntime } from "bit-lite-tester";
import type { VendorDefinition, VendorStartResult } from "bit-lite-vendors";

export const meta: VendorDefinition = {
  id: "example-tester",
  label: "Example Tester",
  hint: "Run component tests with Example",
  moduleUrl: import.meta.url,
};

export default async function start(
  runtime: TesterVendorRuntime
): Promise<VendorStartResult<TestServiceResult>> {
  const { components, context } = runtime.data;

  // Run the tests, then return the first result.
  return { data: { mode: "run", run: 1, stats, componentResults } };
}
```

For watch mode, the vendor sends `ready`, `status`, `result`, and `error` messages through `runtime.postMessage` and returns a `stop` callback when cleanup is required. Each `result` message carries the next `run` number.

## Runtime checks

The following guards are available at module boundaries:

- `isTestServiceResult`
- `isTestComponentResult`
- `isTestStats`

## Package development

```bash
pnpm --filter bit-lite-tester build
pnpm --filter bit-lite-tester typecheck
pnpm --filter bit-lite-tester test
```

Reference implementations are available at `demo-vendors/testers/jest` and `demo-vendors/testers/vitest`.

# Command and Vendor Task Design

## Direction

Bit-lite commands own runtime orchestration. An env is configuration data:

- an explicit package reference used to derive an internal grouping key.
- a namespace for command config such as `services.test`.
- a source of `{ vendor, config }` values.

There is no runtime `ServiceDefinition`, `ServiceRunInput`, or `testService.run()` layer. Commands decide whether they need env grouping, inline execution, worker execution, result aggregation, terminal management, and shutdown handling.

## Test Command Flow

The `test` command owns the whole command workflow:

1. Parse CLI args.
2. Load the workspace.
3. Select target components from `--filter`.
4. Group selected components by env.
5. Read `env.services.test` for each selected env.
6. Use inline mode for normal runs and worker mode for `--watch`.
7. Create one vendor task per env group.
8. Print run-once output as `Test results:`.
9. Manage watch terminal attachment, output, signals, stop, and terminate.

`services.test` remains a config key only. It does not imply that the env owns a behavior object or that commands call `env.run()`.

## Vendor Task Helper

`runVendorTasks()` and `watchVendorTasks()` are the command-facing helpers for vendor-backed workflows. They share an internal base task helper that owns the reusable lifecycle logic:

- validate env config as `{ vendor, config }`.
- dynamically import the vendor module.
- validate `meta: VendorDefinition`.
- pass a structured selected-env identity plus the env service config to the vendor.
- create a `bit-lite-vendors` runner.
- expose a task with `result`, `status`, `details`, `rawOutput`, idempotent `activate`, `postMessage`, `stop`, `terminate`, `writeInput`, `onMessage`, and `onOutput`.
- handle common `ready`, `status`, `error`, and `result` messages.
- collect worker stdout and stderr.

Worker watch tasks are eager unless creation requests deferred activation. A
deferred task keeps stable metadata and terminal identity in `idle` without a
worker; concurrent `activate()` calls share one start. Stopping idle settles it
without creating a worker, and stopping during activation prevents a late
runner from surviving coordinated shutdown.

`postMessage` and `onMessage` are the generic structured message pair at the
task boundary. `postMessage` sends JSON messages from command code into the
vendor runtime, where they arrive through `runtime.onMessage()`. `onMessage`
observes messages sent by the vendor through `runtime.postMessage()`. Fixed
lifecycle methods such as `stop()` and `terminate()` remain separate from this
generic channel.

Command-specific result behavior is passed separately from vendor startup options. `runVendorTasks()` accepts `formatResult(result: unknown) => RunResult | Error` for `runner.start()` / run-once data and then calls the command's `printResults()`. `watchVendorTasks()` accepts a same-named `formatResult(result: unknown) => string[] | Error` for vendor `{ type: "result", data }` messages and uses those strings as task details.

Run-once commands do not need an event result adapter. Watch commands do not assume the run result has the same shape as event result data. For `test`, both helpers currently wrap `isTestServiceResult()`, but that is a command-level choice rather than a helper assumption.

## Config Shape

The env config shape for a vendor-backed command is:

```json
{
  "services": {
    "test": {
      "vendor": "demo-vendors/test-x",
      "config": {
        "shard": "unit",
        "retries": 1,
        "coverage": true
      }
    }
  }
}
```

```ts
export const meta: VendorDefinition = {
  id: "test-x",
  label: "Test X",
  hint: "Sample test runner",
  moduleUrl: import.meta.url
};
```

The effective config passed to the vendor is exactly `env.services.test.config ?? {}`. Vendor definitions do not carry config.

## Result Shape

Each command validates its own run result and event result types through the
helper-specific `formatResult()` function. Selected env identity is always the
closed JSON-safe shape below; a package-name-only result is rejected:

```ts
env: {
  packageName: string;
  requestedVersion: string;
  installedVersion: string;
}
```

The current test result contains `service`, `vendor`, `mode`, `run`, structured
`context.env`, component IDs, args, config, aggregate stats, and per-component
results. Preview service results and manifests use the same structured `env`.

The generic helper does not know what a valid test result is. It only calls the command-provided formatter for the current mode.

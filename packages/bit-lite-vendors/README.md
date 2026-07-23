# bit-lite-vendors

`bit-lite-vendors` is the execution framework behind Bit Lite services.

A vendor is a module selected by an env. The framework can load it inline or in a worker, deliver input data, collect output and application messages, and shut it down consistently.

## Vendor shape

```ts
import type {
  VendorDefinition,
  VendorRuntime,
  VendorStartResult,
} from "bit-lite-vendors";

export const meta: VendorDefinition = {
  id: "example-service",
  label: "Example Service",
  hint: "Run the example integration",
  moduleUrl: import.meta.url,
};

export default async function start(
  runtime: VendorRuntime,
): Promise<VendorStartResult> {
  runtime.postMessage({ type: "ready" });
  runtime.postMessage({ type: "status", status: "running" });

  return {
    data: { started: true },
    async stop() {
      // Close resources created by the vendor.
    },
  };
}
```

The data passed to a worker vendor and the messages exchanged with it must be JSON-safe.

## Vendor context

`createVendorContext` reduces parent-side resolution state to a stable boundary containing:

- context version;
- the base workspace snapshot;
- parsed command arguments;
- selected env package identity;
- service name and the package that declared it.

The complete `EnvContext` is intentionally not sent to vendors.

## Runner API

The root and `bit-lite-vendors/runner` entry points provide:

- `createRunner`
- `createInlineRunner`
- `createWorkerRunner`
- `Runner`, `RunnerRuntime`, and message-related types

Inline runners are useful for lightweight integrations. Worker runners provide isolation, captured output, raw input forwarding, and termination.

## Task API

The root and `bit-lite-vendors/vendor-task` entry points provide:

- `runVendorTasks` for one-shot task groups;
- `createWatchVendorTasks` for persistent tasks;
- `superviseVendorTasks` for the interactive multi-task terminal;
- `stopVendorTasks` for coordinated shutdown.

Task shutdown aggregates failures so one failing cleanup does not prevent the remaining vendors from stopping.

## Package development

```bash
pnpm --filter bit-lite-vendors build
pnpm --filter bit-lite-vendors typecheck
pnpm --filter bit-lite-vendors test
```

[`demo-vendors`](../demo-vendors/README.md) contains working test, preview, and compiler vendors.

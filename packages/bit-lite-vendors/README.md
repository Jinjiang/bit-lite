# bit-lite-vendors

Vendor protocol and runner runtime for Bit-lite.

This package intentionally does not contain concrete vendors. Demo vendors live
in `demo-vendors`, while real integrations can live in packages such as
`@bit-vendors/vitest` or `@bit-vendors/eslint`.

The public API has three layers:

- vendor protocol types such as `VendorDefinition`, `VendorRuntime`,
  `VendorMessage`, and `VendorStartResult`.
- the runner implementation used by Bit-lite to execute vendor modules inline or
  inside a Worker.
- vendor task helpers such as `runVendorTasks()` and `watchVendorTasks()` for
command code that needs common vendor lifecycle handling.

Parent-side task options retain the effective service's declaring package and
JSON entry origin so the vendor is resolved before runner startup. Worker-facing
`VendorData` contains only JSON-safe env identity, selected components, config,
CLI args, and optional command runtime; it does not serialize a workspace/env
runtime graph.

`VendorData.runtime` is an optional JSON-only command-to-vendor channel. Preview
uses it for `server` coordinates plus `prepared.entryFile` and
`prepared.htmlFile`. Preview adapters should not rediscover components, generate
routes, render Markdown, or inject MDX configuration; those inputs are prepared
by the command or imported by the user's dev-server config.

Vendor modules export `meta: VendorDefinition` and a default start function:

```ts
import type { VendorDefinition, VendorRuntime, VendorStartResult } from "bit-lite-vendors";

export const meta: VendorDefinition = {
  id: "example",
  label: "Example",
  hint: "Example vendor",
  moduleUrl: import.meta.url,
};

export default function startExampleVendor(runtime: VendorRuntime): VendorStartResult {
  runtime.postMessage({ type: "ready" });
  runtime.postMessage({ type: "result", data: { ok: true } });

  return {
    stop() {
      runtime.postMessage({ type: "status", status: "stopped" });
    },
  };
}
```

Build and type check with:

```sh
pnpm --filter bit-lite-vendors build
pnpm --filter bit-lite-vendors typecheck
```

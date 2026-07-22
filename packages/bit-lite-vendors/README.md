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

Commands resolve a vendor module from the effective service's declaring package
before runner startup. Both inline and worker execution receive the same common
envelope:

```ts
type VendorData<Config, Runtime> = {
  context: VendorContext;
  components: readonly WorkspaceComponent[];
  config: Config;
  runtime?: Runtime;
};
```

`VendorContext` is a read-only, JSON-safe, versioned extension boundary. Version
1 contains the base `Workspace`, complete parsed CLI arguments (`raw`,
`options` and `passthrough`), the selected env identity, service
name, and the package location that declared the service. It deliberately omits
`WorkspaceContext`, loaded modules, lookup maps, caches, and resolver callbacks.
Vendors should tolerate additive context fields.

The identity is always structured and version-aware:

```ts
env: {
  packageName: "@acme/env.react",
  requestedVersion: "workspace:*",
  installedVersion: "0.0.0",
}
```

The identity lives at `runtime.data.context.env`. An inherited service keeps the
selected child there while `runtime.data.context.service.source` points to the
declaring parent. Vendor-specific module config can use
`resolveServiceSpecifier()` with that source and `context.workspace.rootDir`.

Command parsers retain every argument in `context.args`. The parent still owns
lifecycle decisions such as watch mode and preview ports, while an extension can
read a new option such as `context.args.options.coverage` without a command-side
adapter.

Commands can use `createWatchVendorTasks()` to return caller-owned task
contributions and call `superviseVendorTasks()` separately. This lets a
standalone command own signals and an optional managed terminal, or a composed
command supervise several services without nested terminals.

`VendorData.runtime` is an optional JSON-only command-to-vendor channel. Preview
uses it for `server` coordinates plus `prepared.entryFile` and
`prepared.htmlFile`. Preview adapters should not rediscover components, generate
routes, render Markdown, or inject MDX configuration; those inputs are prepared
by the command or imported by the user's dev-server config.

Vendor outputs contain produced service data only. They must not echo service,
vendor, env, args, config, selected components, or parent-selected output paths.
Task result wrappers retain the original parent-owned context and validated
vendor definition; command validators preserve additional JSON-safe output such
as coverage.

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
  const coverage = runtime.data.context.args.options.coverage;
  runtime.postMessage({ type: "ready" });
  runtime.postMessage({
    type: "result",
    data: { ok: true, ...(coverage === undefined ? {} : { coverage }) },
  });

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

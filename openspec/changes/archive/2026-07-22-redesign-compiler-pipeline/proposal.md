## Why

Compilation lacks watch mode, exposes an unused positional-argument surface, and bypasses configured env services for local env components. Compiler watch behavior also belongs to each compiler vendor—not to a core filesystem watcher—so compile can follow the same composable task/supervision model as test and preview.

## What Changes

- Add `bit-lite compile --watch` as a common compiler-vendor lifecycle flag. Each compiler vendor owns its watcher, incremental behavior, recovery, and cleanup.
- Make compile watch produce caller-owned tasks/contribution data. Standalone compile MAY supervise them through one centralized `ManagedTerminal`; non-interactive and future composed callers MAY supervise without a terminal.
- Keep integration of compile watch into `start` out of scope while preserving the same contribution boundary used by test and preview.
- Route every component, including env components, through its configured env's effective `services.compile`; core SHALL NOT select a compiler from `component.kind`.
- Add `demo-vendors/compilers/env` as an ordinary configured compiler and make it emit flattened, versioned `dist/index.json` with inherited-service provenance.
- Remove command-local positional arguments in place; use `--filter`, named options, and post-`--` passthrough.

## Capabilities

### New Capabilities

- `compile-command`: Defines one-shot and vendor-owned watch compilation, dependency planning, contribution creation, optional centralized supervision, reporting, and shutdown.

### Modified Capabilities

- `env-service-execution`: Makes configured compile services universal for ordinary/env components and extends compiler vendors with the generic watch task lifecycle.
- `env-package-loading`: Replaces fixed local-env materialization with a configured env compiler that emits flattened provenance-preserving JSON.

## Impact

- Affects CLI arguments, `VendorContext`, compiler vendor contracts, compile/install planning, watch task/contribution APIs, env loading, generated package manifests, demo env assignment, and maintained TypeScript/env compiler vendors.
- Moves the filesystem-watching dependency from `bit-lite` core to maintained compiler vendors.
- Requires one-shot and watch coverage for vendor selection, layered startup, optional terminal supervision, failure recovery, cleanup, flattened env provenance, and future `start` composition compatibility without implementing that integration now.

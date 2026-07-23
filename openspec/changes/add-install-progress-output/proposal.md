## Why

`bit-lite install` currently remains silent while dependency resolution, package import, linking, and optional compilation are running, so a slow or stalled install is indistinguishable from a hung command. The command should expose timely, truthful progress without making interactive terminal behavior a requirement for CI or redirected output.

## What Changes

- Add install lifecycle reporting for workspace discovery, dependency installation, component linking, and optional one-shot compilation.
- Show a compact updating status with real pnpm counters on interactive terminals, while using deterministic append-only lifecycle logs on non-interactive streams.
- Translate pnpm logger records into a small Bit-lite-owned dependency progress contract instead of exposing pnpm log objects to the command layer.
- Keep warnings, retries, failures, and the existing final install summaries visible, and clean up progress rendering and logger subscriptions on every exit path.
- Do not present an estimated percentage or ETA when the total amount of dependency work is not known.

## Capabilities

### New Capabilities

- `install-command`: Defines visible install phases, dependency progress, interactive and non-interactive presentation, output ownership, and failure cleanup.

### Modified Capabilities

None.

## Impact

- Affects `packages/bit-lite/src/commands/install.ts` and install command tests.
- Affects `packages/bit-lite-deps` by adding a stable progress callback or event adapter around pnpm's existing logger stream.
- May add a small reusable command-output reporter in `packages/bit-lite` and focused terminal/non-terminal tests.
- Preserves the existing install, link, and `--compile` execution order, dependency semantics, exit behavior, and final summary text.

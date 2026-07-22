## Why

`preview` and `start` currently create a worker-backed preview dev server for every selected env even when the user never visits most of those envs. Large workspaces therefore pay per-env bundler, compiler, watcher, and server costs up front; an opt-in lazy lifecycle can preserve existing navigation while limiting heavy resources to envs that are actually accessed.

## What Changes

- Add an opt-in `--lazy` mode to `preview` and `start`; in `start`, it applies only to preview while test watch tasks remain eager.
- Keep preview discovery and generated input preparation eager, but represent each prepared env as a stable idle logical task whose worker and dev server activate on the first HTTP request or WebSocket upgrade anywhere under that env's registered `/env/<encoded-env>/...` namespace.
- Coalesce concurrent activation requests, wait for the activated server before forwarding the triggering request, isolate per-env activation failures, and stop idle tasks without spawning workers.
- Give each env a deterministic preferred port derived from a default internal preview port and stable env order, preserve the full preferred-port range for idle envs, and direct conflicting servers to a shared fallback range.
- Remove parent-side preview port probing. Preview vendors bind and retry ports, report the actual bound port, and the parent installs the proxy upstream only after validating that result.
- Preserve current eager behavior when `--lazy` is absent and expose idle, starting, ready, failed, and stopped lifecycle state through existing terminal and manifest projections.
- **BREAKING**: Change the preview vendor runtime/result contract so the parent supplies preferred/fallback port hints instead of a preselected final port, and every preview vendor must report its actual bound port as produced service data.

## Capabilities

### New Capabilities
- `lazy-preview-server-lifecycle`: Defines opt-in request-triggered preview activation, stable logical tasks, activation coalescing, preferred/fallback port selection, actual-port publication, failure isolation, and shutdown behavior.

### Modified Capabilities
- `preview-input-preparation`: Replace the parent-selected final vendor port with deterministic preferred/fallback port hints while keeping discovery, module resolution, generated files, and manifest preparation ahead of any vendor activation.
- `env-service-execution`: Extend the shared watch-task lifecycle to support deferred worker activation and require preview vendors to return their actual bound port rather than echoing parent-prepared server coordinates.
- `start-command`: Allow preview contributions to supply idle logical tasks under `start --lazy`, keep test watch eager, and let the central proxy activate preview tasks from any registered env HTTP or WebSocket route.

## Impact

- Affects preview/start orchestration in `packages/bit-lite`, preview runtime and proxy state in `packages/bit-lite-preview`, deferred watch-task lifecycle in `packages/bit-lite-vendors`, and maintained Vite/Webpack adapters in `packages/demo-vendors`.
- Changes the preview vendor input/output API and requires maintained and third-party preview vendors to honor preferred/fallback port hints and report a validated actual port.
- Updates CLI documentation, preview/start manifest and terminal state expectations, unit tests, and Vite/Webpack HTTP, asset, port-conflict, concurrency, WebSocket/HMR, and shutdown end-to-end coverage.
- Does not make preview discovery lazy, make tests lazy, evict idle servers, retry failed activations, or share one dev server across multiple envs.

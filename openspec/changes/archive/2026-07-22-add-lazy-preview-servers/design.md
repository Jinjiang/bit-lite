## Context

Preview preparation and preview execution are currently coupled at contribution construction time. The command discovers docs and demos, resolves preview modules, writes an env-scoped entry and HTML file, selects an available internal port, and immediately creates a worker-backed `VendorTask`. `createWatchVendorTasks()` starts every runner as part of task creation, so each selected env imports its bundler, creates a compiler/module graph, installs file watchers, and opens an internal HTTP server before the user visits any preview URL.

The central proxy already owns a stable public endpoint and recognizes every registered `/env/<encoded-env>/...` namespace. Preview state already permits an env to exist without `server` information and the generic proxy permits asynchronous HTTP and WebSocket handlers. The missing boundary is a stable task that can be supervised before its worker exists, plus a server contract that does not require the parent to reserve an internal port long before a lazy server binds it.

The change crosses `bit-lite`, `bit-lite-preview`, `bit-lite-vendors`, and the maintained Vite and Webpack adapters. It must preserve one terminal/shutdown owner for standalone preview and combined start, keep worker data JSON-safe, retain eager preparation and navigation, and preserve current behavior unless the user opts into `--lazy`.

## Goals / Non-Goals

**Goals:**

- Keep one stable logical preview task per successfully prepared env while avoiding a preview worker, bundler, watcher, compiler, or internal server for an unvisited env in lazy mode.
- Activate an idle env from any HTTP request or WebSocket upgrade under its registered env namespace, coalesce concurrent activations, and forward the triggering traffic after readiness.
- Give envs readable deterministic preferred ports without pre-probing or reserving sockets, let vendors resolve bind conflicts atomically, and route only to a validated actual port.
- Preserve eager preview preparation, existing preview links and public URLs, centralized supervision, failure isolation, structured env identity, and current non-lazy behavior.
- Use the same actual-port result contract for eager and lazy preview execution.

**Non-Goals:**

- Deferring preview discovery, module resolution, or generated-file preparation.
- Lazily starting test watch tasks, compile tasks, or other env services.
- Evicting or restarting an activated server after an idle timeout, automatically retrying a failed activation, or bounding the number of active preview servers.
- Sharing one dev server across envs, expanding aliases across env boundaries, or changing browser preview routing/HMR semantics.
- Eliminating the parent-side cost of resolving and validating vendor metadata; the scaling target is per-env worker and dev-server state.

## Decisions

### 1. `--lazy` controls preview execution, not preparation

`preview --lazy` and `start --lazy` will prepare every selected preview env exactly as today, including component discovery, static demo export analysis, module resolution, generated entry/HTML creation, and manifest link generation. Successfully prepared envs become idle logical tasks. Under `start`, test watch tasks remain eager and `--lazy` affects only preview.

Without `--lazy`, the command will activate every prepared preview task immediately. Both modes therefore share preparation, task, result validation, proxy state, and cleanup code; only the activation trigger differs.

Alternative considered: defer all preparation until first access. This would reduce additional startup I/O, but the root UI could not expose complete docs/composition navigation, configuration failures would move from command startup to page access, and temp-file/manifest state would become more dynamic. It is deferred until measurements show preparation is a material remaining cost.

### 2. Deferred execution is a generic watch-task lifecycle mode

`bit-lite-vendors` will support an opt-in deferred/manual activation mode for worker-backed watch tasks. Creation will still resolve and validate vendor metadata, construct the stable task identity, install message/output listeners, create its result/output state, and return the task to the caller, but it will not call `runner.start()` until an idempotent `activate()` operation is requested.

The logical task transitions from `idle` to `starting`, then uses the existing vendor messages and runner lifecycle. Concurrent `activate()` calls return the same promise. A task can be activated at most once in the first version. Stopping an idle task marks it stopped and settles its exit lifecycle without constructing a worker. Stopping during activation records shutdown intent and stops or terminates the runner once it exists. Terminal attachment remains unavailable while idle and becomes available after worker creation.

This keeps the arrays supplied to `ManagedTerminal` and `superviseVendorTasks()` fixed. Standalone `preview --lazy` remains alive even if no env has been visited, and `start` does not need dynamic terminal items or a second supervision mechanism.

Alternative considered: create a real `VendorTask` only inside the proxy handler. That would require dynamic terminal membership, separate shutdown ownership, placeholder manifest identities, and special handling when preview is the only start service. Alternative considered: start every worker immediately and make each vendor wait for an activation message. That retains one worker and imported vendor runtime per env and places command scheduling policy inside vendors, so it does not meet the main resource goal.

### 3. The parent assigns port preferences; vendors produce actual ports

The parent sorts successfully prepared preview envs by canonical selected-env key. For a default base `P = 6000` and `N` prepared envs, env index `i` receives:

```text
preferredPort = P + i
fallbackStartPort = P + N
```

The entire `[P, P + N - 1]` range is a logical preferred range. No port is probed, bound, or represented as an active endpoint during preparation. A vendor first attempts its own `preferredPort` strictly. If the bind fails because the port is unavailable, it starts conflict-tolerant searching at `fallbackStartPort`, thereby avoiding the preferred ports of idle envs. Concurrent fallback searches rely on actual `listen()` calls to decide ownership and continue after bind conflicts. Search exhaustion at port 65535 is a controlled activation failure.

`PreviewPreparedRuntime.server` will carry `host`, `preferredPort`, `fallbackStartPort`, `basePath`, and `proxyOrigin`, but no final port. A successful preview result must carry `{ mode: "serve", port }`, where `port` is the actual positive integer bound by that vendor execution. The parent combines this produced port with its retained host/base-path state and publishes `PreviewServerInfo` only after validation.

Maintained Vite and Webpack adapters will implement the same two-stage policy with their native server lifecycle. Only bind availability errors are retried; invalid hosts, configuration failures, compiler failures, and unrelated listen errors fail the env. Parent-side `findAvailablePort()` is removed from preview orchestration.

Alternative considered: use port `0` for all servers. It is race-free but produces opaque ephemeral ports that make local diagnosis harder. Alternative considered: pre-check the preferred port in the parent immediately before activation. That retains a time-of-check/time-of-use race and duplicates bind policy outside the server that owns listening. Alternative considered: let a conflicting env increment through other envs' preferred ports. It makes final mappings depend unnecessarily on lazy activation order, so fallback skips the complete preferred range.

### 4. Every registered env request is an activation signal

Preview service routes remain registered before an upstream server exists. They are activation gateways for known env namespaces rather than inactive routes. Both `handleHttp` and `handleUpgrade` resolve the env from any path under `/env/<encoded-env>/...` and call a command-owned `ensureStarted(env)` operation when no upstream exists.

The controller keeps one activation promise per prepared env:

```text
idle request ──> create activation promise ──> task.activate()
concurrent request ──────────────────────────> await same promise
vendor result { port } ──> validate ──> install upstream ──> forward requests
```

The original HTTP request waits and is forwarded unchanged after readiness. A WebSocket socket remains pending and is upgraded after readiness. Request disconnection does not cancel the shared activation because other requests may be waiting and the access has already expressed intent to use that env. Unknown env namespaces never invoke activation. Requests to root presentation, manifests, test routes, or any other namespace do not activate preview envs.

Any traffic in a known env namespace—including direct assets, `HEAD` requests, speculative fetches, and HMR upgrades—may activate the server. This is deliberate: the namespace boundary is the capability and avoids vendor-specific guesses about which child path is a document.

Alternative considered: activate only the env document or `index.html`. It cannot support direct asset/HMR access consistently and makes routing policy depend on current vendor entry conventions.

### 5. Preview state distinguishes prepared, activating, and routable envs

Successfully prepared lazy envs begin as `idle` with complete component links and no `server`. Activation changes the projected status to `starting`. Only a validated result containing the actual port changes it to `ready` and installs `server`. Preparation or activation failures retain a useful reason and no server target. Shutdown produces `stopped` while preserving idempotent cleanup.

Activation failures are cached for the lifetime of the command and concurrent waiters receive the same failure. A later request returns the controlled failed-env response rather than spawning another worker. This avoids refresh-driven retry storms; explicit retry/restart controls can be designed separately.

The activation callback remains a local Node-side dependency injected into preview route construction. It does not cross the worker boundary and does not add service knowledge to the generic `bit-lite-proxy` transport package.

### 6. Shutdown keeps task, vendor, and prepared-file ownership unchanged

The existing supervisor remains the single process-signal and terminal owner. It stops both idle and active logical tasks before contribution disposal removes prepared directories and before the central proxy closes. Idle tasks never spawn during stop. An activation racing with shutdown cannot publish a new upstream after disposal; if a runner is created, it is immediately stopped through the same task lifecycle.

If every env fails eager preparation, standalone preview retains the current behavior of closing the proxy and exiting with the collected failures. A per-env activation failure remains visible without stopping independent preview or test tasks.

## Risks / Trade-offs

- [A speculative or diagnostic request can activate an env] → Treat any access to a registered env namespace as explicit intent, document the behavior, and keep root/manifest polling outside that namespace.
- [The first request waits for worker, bundler, and initial compilation startup] → Preserve the original request and expose `starting` through manifest/terminal state; return a controlled failure if activation rejects rather than requiring a manual intermediate route.
- [Two vendors can race in the fallback range] → Let atomic bind attempts decide ownership, retry only availability errors, and require each vendor to report the port it actually bound.
- [A preferred/fallback range can exceed 65535] → Validate the base and env count before task activation and report a command-owned configuration error rather than wrapping or silently changing the deterministic mapping.
- [Shutdown can race with activation] → Make activation and stop idempotent state-machine operations, record stop intent, reject target publication after disposal, and test idle, starting, and ready shutdown separately.
- [The vendor contract is breaking] → Update the shared types, maintained adapters, validators, tests, and documentation together; fail older vendors with an explicit missing/invalid actual-port error.
- [Lazy mode still pays preparation and vendor-metadata import cost] → Keep this as an intentional first-version boundary and measure startup/RSS before considering lazy preparation or lightweight vendor metadata wrappers.
- [WebSocket clients may time out while a cold server starts] → Await the same activation in the upgrade handler and rely on normal client reconnect behavior if the client closes first; server activation continues for the next attempt.

## Migration Plan

1. Add deferred watch-task activation with eager behavior as the default and cover task lifecycle races before connecting preview.
2. Change preview runtime/result types and validators, then migrate the maintained Vite and Webpack adapters to preferred/fallback binding and actual-port reporting.
3. Move preview proxy server publication to the validated vendor result and add the per-env activation controller/routes.
4. Add `--lazy` orchestration to standalone preview and start while retaining immediate activation when the option is absent.
5. Update unit, integration, end-to-end, README, and design documentation. Verify eager and lazy Vite/Webpack HMR before releasing the breaking vendor contract.

There is no persisted data migration. Rollback requires reverting parent and preview vendor contract changes together; users can disable lazy behavior immediately by omitting `--lazy`, but migrated vendors will still use the actual-port result contract in eager mode.

## Open Questions

No open question blocks the first version. A future change may expose the internal base as `--preview-port`, add activation timeouts/retry controls, split vendor metadata from heavy runtime imports, or add idle/LRU eviction after resource measurements.

## 1. Deferred Vendor Task Lifecycle

- [x] 1.1 Extend `VendorTask` and watch-task creation options with an opt-in deferred activation API while keeping eager runner startup as the default.
- [x] 1.2 Refactor worker-backed task startup so deferred tasks expose stable metadata, result/output state, and listeners in `idle` without constructing a worker, and coalesce concurrent `activate()` calls into one runner start.
- [x] 1.3 Make stop/terminate idempotent for idle, activating, and started tasks, settle an idle task without spawning a worker, and prevent an activation/shutdown race from leaving a runner alive.
- [x] 1.4 Update managed-terminal attachment behavior so one logical item survives activation, remains non-attachable while idle, and becomes attachable when its worker exists.
- [x] 1.5 Add `bit-lite-vendors` unit tests for eager compatibility, idle creation, concurrent activation, one-worker identity/output forwarding, stop-before-activate, and stop-during-activate races.

## 2. Preview Runtime and Vendor Port Contract

- [x] 2.1 Replace the prepared final preview port with JSON-safe `preferredPort` and `fallbackStartPort` hints, require a positive integer actual port in `PreviewServiceResult`, and update runtime/result readers and validators.
- [x] 2.2 Sort successfully prepared envs by canonical selected-env key, assign preferred ports from the internal base of 6000, assign the shared fallback start after the full preferred range, validate range exhaustion, and remove parent-side preview port probing.
- [x] 2.3 Update the maintained Vite preview adapter to attempt its preferred port strictly, retry availability conflicts from the fallback range, read the actual bound port, and return it only after the server is ready.
- [x] 2.4 Update the maintained Webpack preview adapter with the same preferred/fallback bind policy and actual-port result while preserving initial compilation, middleware, HMR, and shutdown behavior.
- [x] 2.5 Add runtime and adapter tests for preferred-port success, occupied preferred ports, skipped idle preferred ranges, concurrent fallback conflicts, exhaustion, non-bind startup errors, and missing/invalid actual-port results.

## 3. Lazy Preview Activation and Proxy Routing

- [x] 3.1 Add a preview env activation controller that binds each prepared env to its stable task, caches one activation promise or failure, validates the vendor result, and publishes `PreviewServerInfo` only from the actual port.
- [x] 3.2 Extend preview state and manifest projection to expose complete prepared navigation with `idle`, transition through `starting`, publish `ready` only with a validated server, and retain controlled activation failure and stopped states.
- [x] 3.3 Make every HTTP request under a known encoded env namespace call or await activation before forwarding the unchanged original request, while root, manifest, test, unknown-env, and unrelated routes never activate preview tasks.
- [x] 3.4 Apply the same activation gate to WebSocket upgrades, preserve the original upgrade after readiness, and allow a shared activation to continue if the triggering HTTP request or socket disconnects.
- [x] 3.5 Integrate activation with contribution disposal so idle tasks never spawn during shutdown, activating tasks cannot publish an upstream after disposal, active vendors stop before prepared-file cleanup, and repeated cleanup remains harmless.
- [x] 3.6 Add `bit-lite-preview` and preview-command tests for direct child-asset activation, first-traffic WebSocket activation, concurrent HTTP/upgrade coalescing, ready fast paths, unknown-route isolation, cached failures, disconnects, and all shutdown states.

## 4. CLI and Combined Start Integration

- [x] 4.1 Parse and validate the boolean `--lazy` command option and pass an explicit preview activation mode into contribution construction without mutating the shared parsed selection.
- [x] 4.2 Keep standalone `preview` eager by default, retain idle logical tasks under `preview --lazy`, and ensure supervision remains alive even before any env is accessed.
- [x] 4.3 Make `start --lazy` defer preview tasks only, continue starting all configured test watch tasks eagerly, and preserve one fixed task array, terminal, signal owner, proxy, and cleanup path.
- [x] 4.4 Update preview/start presentation and manifest expectations for idle/starting/ready/failed/stopped preview state and preferred-versus-actual diagnostic information without changing public component preview URLs.
- [x] 4.5 Extend preview and start command tests for default eager behavior, lazy preview-only behavior, test-watch argument preservation, partial preparation failure, all-preparation failure, terminal attachment transitions, and coordinated shutdown.

## 5. End-to-End Verification and Documentation

- [x] 5.1 Add Vite and Webpack end-to-end coverage proving an unvisited lazy env has no worker/server, any child request starts exactly that env, the original request succeeds through the returned actual port, and a second env adds only its own server.
- [x] 5.2 Cover preferred-port readability and real bind conflicts end to end, including preservation of idle env preferred ports and distinct actual ports for concurrent fallback activation.
- [x] 5.3 Verify cold and already-ready HTTP assets plus Vite WebSocket and Webpack HMR traffic through standalone preview and combined start in both eager and lazy modes.
- [x] 5.4 Update package READMEs and preview command design documentation with `--lazy` semantics, first-request latency, namespace-wide activation, preferred/fallback ports, actual-port vendor migration, failure behavior, and first-version exclusions.
- [x] 5.5 Run the affected package tests, typechecks, and builds with pnpm, then fix regressions in existing preview, start, vendor-task, proxy, test-watch, and HMR behavior.

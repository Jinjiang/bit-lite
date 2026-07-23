## 1. Managed Terminal Interrupt Contract

- [x] 1.1 Replace managed-terminal quit reasons with one Ctrl+C interrupt callback, remove `q` shutdown handling, and update the displayed instructions.
- [x] 1.2 Add terminal tests proving Ctrl+C invokes the interrupt callback, `q` leaves the session active, and `stop()` restores raw mode, input state, and the cursor.

## 2. Private Runner Shutdown and Bounded Task Stop

- [x] 2.1 Make built-in runner shutdown private to the inline runner and worker entry so it is handled before application messages and invokes the returned vendor stop hook at most once.
- [x] 2.2 Narrow exported runner and vendor runtime message types so `VendorRuntime.onMessage()` contains only service-defined input messages.
- [x] 2.3 Move graceful-exit waiting and forced worker termination behind the idempotent `VendorTask.stop()` operation for idle, activating, and active tasks, and make collection stopping run every bounded stop concurrently before surfacing combined failures.
- [x] 2.4 Remove command-facing task `terminate`, exit-wait, and timeout-policy requirements while retaining the internal bounded fallback.
- [x] 2.5 Remove the unused `watchVendorTasks()` compatibility composition, `WatchVendorTasksOptions`, and their exports now that maintained production callers use explicit creation and supervision phases.
- [x] 2.6 Update vendor-task and runner tests for single-hook shutdown, hung cleanup fallback, repeated stop, deferred activation races, one-stop rejection with unrelated-stop continuation, combined cleanup failures, and application-message isolation.
- [x] 2.7 Rewrite the former `watchVendorTasks()` compatibility test to exercise `createWatchVendorTasks()` plus `superviseVendorTasks()` directly without recreating a combined helper.

## 3. Maintained Vendor Cleanup Hooks

- [x] 3.1 Remove built-in shutdown-message listeners from maintained compiler watch vendors while preserving their returned idempotent stop hooks and startup-error cleanup.
- [x] 3.2 Update Vite, Webpack, Vitest, Jest, and sample vendors to rely only on returned stop hooks, removing their existing built-in shutdown-message listeners and helper types while preserving native watcher, server, middleware, and test-pool cleanup.
- [x] 3.3 Update maintained vendor tests to verify each returned stop hook releases resources and is invoked no more than once by runner shutdown.

## 4. Aggregate Contribution Ownership

- [x] 4.1 Narrow `WatchCommandContribution.dispose()` to `Promise<void>` and keep the existing vendor watch execution disposer as the cached inner owner for disposal intent, all contributed tasks, and prepared-resource cleanup.
- [x] 4.2 Preserve compile and test contribution delegation to the vendor watch execution disposer, and verify repeated or concurrent disposal returns the same promise and stops each task once.
- [x] 4.3 Replace the generic command result-store utility with test-watch-contribution-owned append-only result entries and a test-specific read model, migrate command and route tests, and remove the standalone generic result-store tests while preserving latest-result and terminal-text behavior.
- [x] 4.4 Compose preview state and listener cleanup around the vendor watch execution disposer under one cached promise, attempting every task, prepared-file, listener, and state cleanup before surfacing combined failures.
- [x] 4.5 Add contribution and vendor execution tests for direct programmatic disposal, shared-promise identity, cleanup rejection with later-cleanup continuation, partial construction failure, and disposal racing with deferred activation.

## 5. Signal-Only Root Supervision

- [x] 5.1 Simplify `superviseVendorTasks()` to own only SIGINT/SIGTERM listeners, optional managed-terminal lifecycle, one cached aggregate disposer, and original-signal completion.
- [x] 5.2 Remove quit/completed shutdown reasons, reason-formatting callbacks, supervisor-side task stopping, and the `onTasksStarted()` cleanup handshake.
- [x] 5.3 Update standalone compile, test, and preview wrappers to pass their complete aggregate disposer to root supervision and use the same disposer for startup rollback.
- [x] 5.4 Simplify start to use one cached root disposer that attempts test and preview contribution disposal before proxy closure, continues after individual cleanup failures, and never separately stops their combined task list or tracks supervision handoff.
- [x] 5.5 Add root-session tests for Ctrl+C, SIGINT, SIGTERM, non-terminating `q`, repeated signals, shared disposal completion, listener detachment, terminal restoration before async cleanup, cleanup-failure continuation, and preserved signal semantics.
- [x] 5.6 Update start startup-failure tests to assert each created contribution owns task stopping, every created contribution and the proxy receive a cleanup attempt after an earlier rejection, and initiating plus cleanup failures are reported after cleanup settles.

## 6. Public Surface and Verification

- [x] 6.1 Update `bit-lite-terminal`, `bit-lite-vendors`, and command documentation and examples to describe signal-only user termination, aggregate contribution ownership, and only the two-phase `createWatchVendorTasks()` plus `superviseVendorTasks()` watch integration.
- [x] 6.2 Remove obsolete shutdown exports, `VendorRuntimeState`, vendor helper files, and compatibility references, then run repository searches to verify no maintained caller uses them.
- [x] 6.3 Verify that the confirmed API removals do not change whether general runner primitives are re-exported from the package root.
- [x] 6.4 Run the affected package unit tests, command integration tests, type checks, builds, and watch lifecycle end-to-end tests with pnpm.

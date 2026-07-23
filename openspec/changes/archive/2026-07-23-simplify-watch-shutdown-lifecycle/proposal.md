## Why

Watch command shutdown currently crosses terminal quit reasons, process signals, supervisor cleanup, task stop/terminate fallbacks, runner shutdown messages, vendor listeners, returned vendor stop hooks, contribution disposal, and command `finally` blocks. The shared vendor watch executor now gives compile, test, and preview an internal task-and-preparation disposer, but root supervision and command wrappers still stop or dispose the same work again. The overlap makes ownership hard to explain and leaves failure paths able to skip unrelated cleanup.

## What Changes

- Make Ctrl+C, SIGINT, and SIGTERM the only user-triggered ways to end a resident watch session; remove `q` and other terminal-level quit paths from command shutdown behavior.
- Give each root watch session exactly one process-signal owner and make raw-terminal Ctrl+C enter that same signal-driven path.
- Define contribution `dispose()` as one shared-promise aggregate cleanup operation for all tasks and auxiliary resources created by that contribution, building on the existing vendor watch execution disposer.
- Attempt every owned cleanup even when one task, listener, prepared resource, child contribution, or root resource fails, then surface the combined cleanup failure.
- Reduce the caller-facing task lifecycle to one idempotent stop operation; graceful vendor cleanup and forced worker termination remain bounded internal behavior rather than separate command concerns.
- Make the vendor's returned stop hook the single graceful vendor cleanup mechanism, keeping runner shutdown control private instead of delivering it as an application message.
- Remove the obsolete `VendorRuntimeState`, `watchVendorTasks()`, and `WatchVendorTasksOptions` compatibility APIs; document `createWatchVendorTasks()` plus `superviseVendorTasks()` as the only watch-task integration.
- Replace the generic command result-store utility with a test-watch-contribution-owned result history and read model while preserving the existing start and test result behavior.
- Preserve programmatic disposal for startup rollback, composition, lazy-activation races, and tests even though it is no longer a user-facing quit mechanism.
- **BREAKING** Remove terminal `q` shutdown behavior, the obsolete compatibility APIs above, and public runner/vendor lifecycle types that expose built-in shutdown messages or separate forced termination details.

## Capabilities

### New Capabilities

- `watch-session-lifecycle`: Defines signal-only watch termination, root session ownership, aggregate contribution disposal, bounded task stopping, and the single vendor cleanup hook.

### Modified Capabilities

- `start-command`: Replaces generic terminal quit with signal-only termination and assigns task cleanup to child contribution disposal instead of duplicating it in central supervision.

## Impact

- Affects `bit-lite-terminal` keyboard handling and shutdown-related types.
- Affects `bit-lite-vendors` supervision, task, runner, worker-entry, and public lifecycle exports.
- Affects the shared vendor watch execution disposer, compile, test, preview, and start watch wrappers, contribution cleanup, and the test contribution's result read model.
- Affects maintained compiler, tester, and preview vendor implementations that currently listen for the built-in shutdown message.
- Requires lifecycle and regression tests for Ctrl+C, SIGINT, SIGTERM, startup rollback, deferred activation, bounded forced termination, terminal restoration, shared-promise and failure-resilient aggregate disposal, two-phase watch integration, and preserved test-result reads.

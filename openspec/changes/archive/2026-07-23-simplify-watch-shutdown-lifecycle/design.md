## Context

Resident commands currently combine several independently reasonable lifecycle mechanisms:

- `ManagedTerminal` interprets both `q` and Ctrl+C as quit reasons while stdin is in raw mode.
- `superviseVendorTasks()` owns process signals, stops every task, waits for worker exits, force-terminates remaining workers, invokes an `onTasksStarted()` cleanup hook, and re-sends the original signal.
- `createVendorWatchExecution()` already records disposal intent, returns one cached disposal promise, stops its tasks, and releases prepared resources. Compile and test contributions expose that disposer directly, while preview composes it with state and listener cleanup behind a separate boolean guard.
- A worker shutdown message is delivered to vendor `runtime.onMessage()` listeners and the worker entry then also calls the stop hook returned by the vendor.
- Command `finally` blocks repeat contribution and root-resource cleanup after supervision.

This creates overlapping ownership despite the newer command-side execution boundary. Compile, test, and preview contributions now all reach task cleanup through the shared executor, but each standalone supervisor still stops the same task list before invoking contribution cleanup, and start still stops the combined child task list before disposing both contributions. Preview and root command wrappers use boolean guards rather than exposing one shared completion promise, and a rejection from one cleanup can skip later listeners, prepared resources, sibling contributions, or the proxy. Maintained vendors commonly register a shutdown-message listener and return the same idempotent stop function, so one runner request also reaches that function twice.

The public and command-internal compatibility surface also retains shapes that no maintained production caller needs. `watchVendorTasks()` and `WatchVendorTasksOptions` hide the creation/supervision ownership split, `VendorRuntimeState` duplicates task state while exposing runner and exit details, and the generic result-store utility is used only as the test contribution's append-only result history.

The desired product behavior is narrower: a resident command is ended by Ctrl+C or a supported process termination signal. Programmatic cleanup is still necessary for partial startup failure, composed callers, lazy activation races, tests, and normal resource ownership, but it is not another user-visible quit mechanism.

## Goals / Non-Goals

**Goals:**

- Make Ctrl+C, SIGINT, and SIGTERM the only user-triggered resident-session termination inputs.
- Install one signal owner at the root standalone or composed command, never in child contributions or vendors.
- Give each contribution one complete aggregate disposer that returns a cached promise and consistently composes its existing vendor watch execution disposer with command-owned resources.
- Attempt every owned cleanup before surfacing an aggregate failure, including prepared-resource and sibling/root-resource cleanup after an earlier failure.
- Expose one idempotent caller-facing task stop operation while retaining bounded graceful cleanup and forced termination internally.
- Invoke each vendor's returned stop hook at most once and keep built-in runner shutdown out of application messages.
- Restore terminal state before asynchronous cleanup and preserve the original signal's process-exit semantics.
- Retain deterministic cleanup for startup rollback and deferred activation without requiring a process signal.
- Remove obsolete compatibility APIs and keep test-result storage owned by the test contribution that produces and serves it.

**Non-Goals:**

- Supporting graceful cleanup after SIGKILL or an unrecoverable runtime crash.
- Adding new user quit commands, remote shutdown endpoints, or per-task stop controls.
- Changing structured vendor status, result, or error messages.
- Changing which compile, test, or preview work is selected or how those services run.
- Removing local vendor cleanup functions used to recover from errors during vendor startup.
- Deciding whether general runner primitives such as the runner factories continue to be re-exported from the package root.

## Decisions

### 1. The root watch session is the only termination owner

`superviseVendorTasks()` remains the reusable root-session boundary for standalone compile, test, preview, and composed start sessions. It owns exactly one SIGINT listener and one SIGTERM listener while active. Child contribution factories, logical tasks, runners, and vendors do not install process signal listeners.

An interactive `ManagedTerminal` reports only an interrupt event. Because raw mode prevents the operating system from generating SIGINT for the typed Ctrl+C byte, the supervisor maps that event onto its SIGINT shutdown path. `q` is an ordinary menu key with no shutdown behavior and is removed from terminal instructions.

The first supported signal stops the terminal synchronously, begins root disposal once, removes session listeners, and then restores normal process semantics by re-sending the original signal after disposal. Ctrl+C is treated as SIGINT. Repeated termination requests cannot enter disposal twice.

Startup failure, an empty task selection, or an explicit programmatic contribution disposal can still end or clean a command without masquerading as a user termination signal.

Alternative considered: install no signal handlers and let the operating system terminate the process immediately. This is smaller but can leave stdin in raw mode, skip prepared-file cleanup, and fail to terminate subprocesses owned by a test or preview integration.

### 2. Contributions own their tasks and auxiliary resources

`WatchCommandContribution.dispose()` becomes a `Promise<void>`-returning complete aggregate ownership boundary. The existing `VendorWatchExecution.dispose()` is the inner owner for tasks, disposal intent, deferred-readiness races, and prepared-resource cleanup. Compile and test can continue forwarding that disposer directly. Preview wraps it with preview state and listener cleanup, but the wrapper and all root resource disposers return one cached promise rather than using an async boolean fast path.

Every contribution disposer:

1. records disposal intent so deferred activation cannot create a surviving worker;
2. stops all logical tasks it created;
3. detaches its task and state listeners;
4. releases service-owned resources such as prepared preview directories; and
5. attempts later cleanup stages even if an earlier stage rejects;
6. settles only after every owned cleanup attempt finishes and then surfaces the combined cleanup failure; and
7. returns the same cached completion promise when called again.

The supervisor receives one root `dispose` callback and does not independently stop the task list. Standalone commands pass their contribution disposer, with any command-owned resources wrapped around it. Start passes a root disposer that requests test and preview contribution disposal before closing the central proxy. Dependency order is preserved, but a rejection from one child does not prevent the remaining child or proxy cleanup; failures are reported only after all required attempts finish.

The same disposer is used for partial startup rollback before supervision begins. This removes the distinction between cleanup performed after `onTasksStarted()` and cleanup performed in command `finally` blocks.

Alternative considered: let the supervisor own all tasks while contribution disposal handles only auxiliary resources. That keeps the current combined task view convenient, but it makes a contribution unsafe to dispose independently and requires callers to remember two cleanup operations in the correct order.

### 3. A logical task exposes one bounded stop operation

`VendorTask.stop()` remains the single caller-facing primitive for idle, activating, and active tasks. It is idempotent and absorbs the current graceful/forced sequence:

- an idle task settles as stopped without constructing a worker;
- an activating task records stop intent and prevents a newly created worker from surviving;
- an active worker receives the private runner shutdown request;
- the task waits for worker exit for one internal grace interval; and
- a worker that does not exit is force-terminated within one additional internal interval.

Separate caller-facing `terminate()`, `exitPromise`, and timeout configuration are removed or made runner-internal. Collection cleanup stops tasks concurrently and settles every task even when an individual graceful hook fails. The shared vendor watch execution disposer then attempts every prepared-resource cleanup in reverse preparation order before surfacing the combined task and resource cleanup failure.

The grace intervals remain fixed implementation constants initially. They can be made configurable later if real integrations demonstrate a need; exposing them now would recreate lifecycle policy in every command.

Alternative considered: always call `Worker.terminate()` immediately. This is attractive for simplicity but gives integrations no opportunity to close test pools, development servers, file watchers, or child subprocesses.

### 4. The returned vendor stop hook is the only graceful vendor cleanup path

The runner's built-in shutdown request becomes private control traffic handled by the inline runner or worker entry before application messages are dispatched. `VendorRuntime.onMessage()` receives only service-defined input messages.

On private shutdown, the worker entry invokes the optional `VendorStartResult.stop()` hook once and then exits. Maintained vendors remove their shutdown-message listeners and `isShutdownMessage()` helpers while retaining local idempotent stop functions for both the returned hook and startup-error rollback.

This preserves a narrow extension contract:

```text
parent task.stop()
  -> private runner shutdown
    -> returned vendor stop hook once
      -> worker exits
        -> force terminate only if the bounded wait expires
```

Alternative considered: retain both shutdown-message delivery and the returned stop hook, relying on vendor idempotence. That is the current design and is precisely the duplicate ownership this change removes.

### 5. Terminal cleanup and task cleanup remain separate responsibilities

`ManagedTerminal.stop()` remains a UI lifecycle method: it removes the keypress listener, exits raw mode, pauses stdin, and restores the cursor. It does not stop tasks or own signals.

The quit-reason API is narrowed to a single interrupt callback. This keeps terminal restoration immediate when either typed Ctrl+C or an external signal starts shutdown, even if a vendor cleanup hook later hangs and requires forced termination.

### 6. Obsolete compatibility layers are removed without broadening the runner export decision

`watchVendorTasks()` and its combined `WatchVendorTasksOptions` type are removed. Production commands already use the explicit `createWatchVendorTasks()` plus `superviseVendorTasks()` phases, which make ownership visible. The former compatibility test is rewritten to exercise those two phases directly, and the vendor package README recommends only the two-phase watch integration.

The unused `VendorRuntimeState` type is also removed. It duplicates logical task presentation state while exposing the runner and worker-exit details that this change moves behind `VendorTask.stop()`.

The generic command result-store utility and its standalone generic tests are removed. The test watch contribution instead owns its append-only test-result entries and exposes the test-specific read model required by test routes and start. Existing latest-result selection, structured result data, observation timestamps, and terminal-text behavior remain unchanged.

This cleanup does not decide whether general runner factories and primitives continue to be re-exported from the package root. That export-layout question is independent from removing the confirmed obsolete APIs and can be handled separately.

Alternative considered: retain the compatibility APIs and generic store for a later cleanup. This would leave the same files exposing superseded lifecycle concepts while the underlying ownership contract changes, and would preserve an otherwise unused abstraction solely for its own tests.

## Risks / Trade-offs

- **[Risk] Removing `q` surprises users familiar with the current help text.** → Update terminal instructions and README examples together, and cover `q` as a non-terminating key in regression tests.
- **[Risk] A vendor stop hook can reject or hang.** → Keep stop idempotent, bound the grace period, force-terminate the worker, settle all task and resource cleanup attempts, and report the combined failure only after unrelated contributions and root resources are released.
- **[Risk] A worker-owned subprocess can outlive abrupt worker termination.** → Prefer the returned graceful stop hook first; maintained tester and preview vendors must close their native resources there.
- **[Risk] Adapting the newer generic executor can accidentally recreate or duplicate its task ownership.** → Keep `VendorWatchExecution.dispose()` as the inner boundary, compose only command-owned resources around it, remove supervisor-side task stopping, and assert one stop call per task.
- **[Risk] Replacing the generic result store changes observable start test pages.** → Keep the test-specific entry shape and latest-result lookup behavior, and migrate command and route tests before deleting the generic utility.
- **[Risk] Re-sending a signal can complicate unit tests.** → Isolate signal completion behind one small process-lifecycle helper and mock only that boundary.
- **[Trade-off] Programmatic `dispose()` still exists despite signal-only user termination.** → This is intentional: cleanup ownership and user-facing termination are different contracts.

## Migration Plan

1. Narrow managed-terminal interruption behavior and update its tests and documentation.
2. Make runner shutdown private, retain one returned vendor stop hook, and migrate maintained vendors away from shutdown-message listeners.
3. Collapse task graceful/forced shutdown behind the single idempotent task stop operation.
4. Preserve the shared vendor watch executor as the inner task/prepared-resource owner, narrow contribution disposal to a cached `Promise<void>`, compose preview-specific listener/state cleanup around it, and move test-result history into the test contribution's read model.
5. Simplify root supervision to signal ownership, terminal restoration, and one aggregate disposer; migrate standalone wrappers and start.
6. Remove the confirmed compatibility functions, option and state types, generic result-store utility, and obsolete documentation; update regression and end-to-end tests.

The change can be rolled back package by package by restoring the previous public lifecycle types and supervisor task ownership before restoring vendor shutdown-message listeners. No workspace configuration or persisted data migration is required.

## Open Questions

- Whether the fixed internal graceful and forced-stop intervals should retain the current 300 ms values or use a slightly larger constant for test and preview integrations. This does not change the public lifecycle contract.

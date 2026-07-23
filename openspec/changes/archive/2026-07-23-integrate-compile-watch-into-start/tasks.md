## 1. Strict Watch Alias

- [x] 1.1 Add a narrow `watch` command adapter that rejects effective `watch: false`, clones command options with `watch: true`, and preserves raw arguments, passthrough, workspace, filters, and the source parsed value.
- [x] 1.2 Register `watch` in CLI dispatch so it calls the same standalone compile-watch runner as `compile --watch` without duplicating selection, planning, contribution, supervision, or cleanup logic.
- [x] 1.3 Add CLI and parser tests for dispatch, redundant `--watch`, rejected `--no-watch` before workspace preparation, repeated filters, workspace selection, unknown options, passthrough ordering, raw argument preservation, source immutability, and unchanged `-w` workspace semantics.

## 2. Compile Root Planning and Readiness

- [x] 2.1 Add start-facing compile-root derivation from the resolved canonical selection so selected components without `services.compile` are omitted while their preview/test participation remains unchanged.
- [x] 2.2 Extend compile planning diagnostics to distinguish optional omitted roots from mandatory included local env prerequisites that are unavailable, lack compile, or fail and block dependents.
- [x] 2.3 Expose one cached all-task readiness barrier from the compile watch contribution using first validated results for every prerequisite, final-layer, and single-layer task.
- [x] 2.4 Ensure initial contribution construction/readiness failures use the contribution's cached aggregate disposer, stop partial tasks, retain prerequisite identity in the error, and do not leak watchers.
- [x] 2.5 Add compile tests for optional root omission, mandatory prerequisite absence/missing service/failure, dependency-layer ordering, final-layer and single-layer readiness, runtime failure after readiness with recovery, non-mutating effective arguments, and shared disposal/readiness promises.

## 3. Staged Start Composition

- [x] 3.1 Change start's empty-service decision to consider compile roots together with preview/test services, retaining the early no-task exit only when none can contribute work.
- [x] 3.2 Create the compile contribution first and await its complete readiness barrier before opening preview or test contributions; open the proxy and continue normally for compile-only selections.
- [x] 3.3 Construct preview and test only after compile readiness, apply `--lazy` only to preview, keep compile/test eager, and supervise one stable combined compile/preview/test task array.
- [x] 3.4 Implement one cached root disposer that attempts preview/test cleanup, then compile cleanup, then proxy closure, aggregates failures, and is reused by startup rollback and root supervision without separately stopping tasks.
- [x] 3.5 Add start unit tests for compile-before-preview/test ordering, compile-only start, mixed services with selected components lacking compile, lazy preview with eager compile/test, one resolved selection, one supervisor, and no nested terminal or signal owner.
- [x] 3.6 Add startup rollback tests for compile barrier failure, missing/failed mandatory prerequisites, later contribution failure, proxy/route failure, repeated disposal, and continuation through one or more cleanup rejections with combined error reporting.

## 4. Start Manifest and UI

- [x] 4.1 Seed the start manifest component catalog from the canonical selected components so compile-only and service-optional components retain source-browser entries.
- [x] 4.2 Add live top-level compile task records and selected-component compile bindings containing task, component, env, vendor, and structured status identity, including prerequisite tasks outside the direct selection.
- [x] 4.3 Update the polling start UI to display read-only compile identity/status while adding no compile control, result-history route, artifact detail, or component-attributed raw terminal output.
- [x] 4.4 Extend manifest, route, and shell tests for compile-only presentation, optional missing compile, prerequisite task visibility, live failure/recovery status, source links, and the absence of compile controls or raw-output history.

## 5. Unified Lifecycle and End-to-End Coverage

- [x] 5.1 Reconcile start and compile wrappers with the `simplify-watch-shutdown-lifecycle` contract so the root supervisor owns the only ManagedTerminal and SIGINT/SIGTERM listeners and contributions own task cleanup exactly once.
- [x] 5.2 Add interactive lifecycle coverage proving compile, preview, and test tasks share one terminal, compile raw stdout/stderr remains attached to its component-level task, and coordinated shutdown does not create duplicate stop/dispose calls.
- [x] 5.3 Add non-interactive coverage for mixed and compile-only start sessions proving tasks remain resident, the proxy/UI remains available, and no ManagedTerminal is constructed.
- [x] 5.4 Add an end-to-end cross-env startup test proving all included compile artifacts become initially ready before preview/test imports, plus mixed-service coverage where a selected component lacking compile still receives available preview/test behavior.

## 6. Documentation and Verification

- [x] 6.1 Update CLI help and `packages/bit-lite/README.md` to document compile integration in start, compile-only sessions, readiness ordering, preview-only lazy behavior, and the strict `watch` alias with rejected `--no-watch` and unchanged `-w`.
- [x] 6.2 Run the affected `bit-lite-context`, `bit-lite-vendors`, `bit-lite-terminal`, and `bit-lite` unit/integration suites with pnpm, including CLI, compile, start, manifest/UI, lifecycle, rollback, and non-interactive tests.
- [x] 6.3 Run affected pnpm type checks and builds, then run final OpenSpec status and strict validation for `integrate-compile-watch-into-start`.

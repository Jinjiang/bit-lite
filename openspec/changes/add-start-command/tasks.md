## 1. Share One Resolved Command Selection

- [x] 1.1 Add an internal resolved-command-selection helper that calls workspace preparation once, selects canonical `WorkspaceComponent` objects from `WorkspaceContext.workspace`, and derives `WorkspaceEnvGroup` objects once.
- [x] 1.2 Migrate preview and test input preparation to consume the resolved selection while preserving their standalone behavior and avoiding a second workspace/context model.
- [x] 1.3 Add tests proving one preparation call per command, preservation of component filters, and shared canonical workspace, component, env-context, and group references.

## 2. Separate Watch Task Creation and Supervision

- [x] 2.1 Extract and export a worker-backed watch-task creation API from `watchVendorTasks` that installs formatting/result callbacks and returns started `VendorTask` objects without creating a terminal or signal owner.
- [x] 2.2 Extract and export a supervisor for existing task arrays that owns at most one `ManagedTerminal`, one signal-listener set, non-TTY watch lifetime, and one idempotent shutdown path.
- [x] 2.3 Derive task IDs and terminal labels from `VendorContext.service.name`, the selected env key, and loaded vendor, and test cross-service uniqueness plus task-specific buffered output/input attachment.
- [x] 2.4 Make shutdown order stop terminal rendering, stop or terminate tasks, detach task/process listeners, run contribution cleanup, and finally close parent resources; cover repeated cleanup and partial startup.
- [x] 2.5 Rebuild `watchVendorTasks` as the compatibility composition of task creation and supervision, with regression tests for interactive, non-interactive, quit, signal, and completion paths.

## 3. Extract Generic Proxy Transport

- [x] 3.1 Add the `bit-lite-proxy` workspace package with route types, ordered registration, duplicate-ID validation, available-port listening, controlled 404 handling, socket tracking, and idempotent close behavior.
- [x] 3.2 Move generic HTML/JSON/error response helpers and HTTP/WebSocket forwarding into `bit-lite-proxy` without importing preview, test, command, manifest, or UI types.
- [x] 3.3 Add focused proxy-package tests for route precedence, duplicate routes, unmatched requests, socket cleanup, HTTP forwarding, and WebSocket upgrades.
- [x] 3.4 Refactor `bit-lite-preview` into preview state/link generation, env service routes, and standalone shell/manifest routes backed by `bit-lite-proxy`, using full selected-env keys internally and package-name base paths publicly.
- [x] 3.5 Update preview tests to prove encoded env routing, preparation failures, HTTP/WebSocket proxying, and standalone manifest compatibility: structured `env`, no `envName`, and no top-level `skipped`.

## 4. Add Preview and Test Contributions

- [x] 4.1 Define the minimal shared watch-command contribution shape for service identity, tasks, routes, and idempotent disposal without adding action or capability metadata.
- [x] 4.2 Add a preview contribution entry point that accepts the shared resolved selection and central proxy endpoint, resolves inherited service vendors/config from the declaring source, prepares envs, starts preview tasks, and returns preview state, unavailable/failure state, env routes, and cleanup without opening a server or terminal.
- [x] 4.3 Rebuild standalone preview around one resolved selection, the preview contribution, preview-only root/manifest routes, and the shared supervisor.
- [x] 4.4 Add a test watch contribution entry point that accepts the shared resolved selection, creates a non-mutating effective argument value with parsed watch enabled, starts test tasks, stores structured events, binds canonical component IDs to actual tasks, and opens no server or terminal.
- [x] 4.5 Rebuild the `test --watch` path around one resolved selection, the test contribution, and the shared supervisor while leaving the one-shot test path unchanged.
- [x] 4.6 Add contribution tests proving prompt return with caller-owned tasks, no child terminal/listener/server, no repeated preparation, shared canonical references, preserved raw/unknown/passthrough arguments, missing-service handling, inherited service-source resolution, and idempotent cleanup.

## 5. Build Start Read Models and Routes

- [x] 5.1 Implement the start manifest by combining current preview state, separate preview unavailable/failure state, and test task/component summaries while using structured selected-env identity and leaving the standalone preview manifest unchanged.
- [x] 5.2 Implement component-result lookup by resolving the component's bound test task, scanning `ResultStore` newest-first, filtering by the exact task ID, and selecting the newest event that contains the component.
- [x] 5.3 Implement bounded env terminal-output serialization from the bound test task's `RawOutputBuffer`, including safe UTF-8/control-sequence normalization and explicit env-scope/latest-output notices.
- [x] 5.4 Add read-only handlers for `/tests`, `/__bit-lite/test-results.json`, and the combined `/__bit-lite/manifest.json`, including structured env/task/vendor metadata plus pending, unknown-component, and unavailable-test states.
- [x] 5.5 Add the combined start shell and component test page with periodic GET refresh, preview/test navigation, structured result details, env terminal text, scope notices, safe text rendering, and no rerun controls.
- [x] 5.6 Add route/read-model tests for encoded component IDs, selected child env versus inherited service source, live task state, unrelated task IDs, incremental results, output before results, buffer eviction, standalone preview compatibility, and absence of state-changing routes.

## 6. Orchestrate the Start Command

- [x] 6.1 Add `runStartCommand` to create one resolved selection, exit before listening when neither service is configured, then open the central proxy, obtain preview/test contributions, register service and start routes, and supervise all tasks in one session.
- [x] 6.2 Implement expected preview preparation-failure isolation and rollback for contribution or route-registration failures with task-stop, listener-detach, contribution-dispose, and proxy-close ordering.
- [x] 6.3 Register `start` in the CLI and update help text, command documentation, package dependencies, exports, and UI asset build/copy steps.
- [x] 6.4 Add start command tests for both services, preview-only/test-only envs, filters, one workspace preparation, automatic test watch mode without argument mutation, one central terminal/public proxy, non-TTY watch operation, no-service no-listener exit, and coordinated quit/signal shutdown.

## 7. End-to-End Verification

- [x] 7.1 Add an env-package-based end-to-end fixture, including inherited service configuration, that exercises the current workspace/context loading model rather than legacy workspace service config.
- [x] 7.2 Verify through the central origin that real preview HTTP assets and HMR WebSocket updates use the env base path exactly once while test watch results and env-level output continue to update.
- [x] 7.3 Run targeted package tests and typechecks with pnpm, then run the repository test, typecheck, and build suites and fix regressions.
- [x] 7.4 Manually smoke-test standalone `preview`, standalone `test --watch`, and combined `start`, confirming standalone manifest compatibility, one terminal/public proxy, structured env identity, read-only test UI, and accurate component/env scope notices.

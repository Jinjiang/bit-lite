## Why

`bit-lite start` currently composes preview and test while leaving compile watch as a separate resident command, so cross-env imports can observe missing or stale `dist` artifacts and developers need another supervisor and terminal to keep compilation alive. The CLI also lacks a concise compile-watch entry point even though `compile --watch` is already a complete workflow.

## What Changes

- Extend `bit-lite start` to compose component-level compile, env-level preview, and env-level test watch contributions from one resolved selection.
- Create compile first and wait for every included compile task's initial successful result/readiness before starting preview or test; on initial failure, roll back every contribution and root resource already created.
- Skip compile for selected components whose effective env has no `services.compile` without suppressing their available preview or test services, while retaining dependency-plan ordering and explicit failure semantics for required local env prerequisites.
- Treat a compile-only selection as a valid start session that still opens the central proxy, source browser, start manifest, and UI.
- Keep compile and test eager while `--lazy` affects preview only.
- Put all three service types in one optional `ManagedTerminal`, one signal-owned root session, and one aggregate disposal path, without nested supervision or duplicate task stopping.
- Expose compile task identity and live status in the start manifest/UI while keeping raw compiler terminal output task-scoped and separate from component-level structured compile history; add no compile controls.
- Add top-level `bit-lite watch` as a strict alias for `bit-lite compile --watch`. The alias reuses the compile-watch runner, forces effective `options.watch` to `true`, preserves the user's original raw/options/passthrough arguments plus global filters/workspace, rejects conflicting `--no-watch`, and leaves `-w` assigned to `--workspace`.
- Update CLI help and README documentation to describe the alias and integrated start behavior.

## Capabilities

### New Capabilities

- `watch-command`: Defines CLI dispatch and argument semantics for the strict `bit-lite watch` alias of `bit-lite compile --watch`.

### Modified Capabilities

- `start-command`: Adds compile contribution selection, readiness ordering, unified presentation and supervision, compile-only sessions, and three-service rollback/disposal behavior.
- `compile-command`: Defines compile-watch reuse by start and the watch alias, including service-optional selection and prerequisite readiness/failure semantics.

## Impact

- Affects CLI dispatch, argument validation, help text, and the `bit-lite` README.
- Affects compile contribution planning/preparation, start orchestration, combined task supervision, startup rollback, start manifest types/routes, and start UI rendering.
- Extends compile, start, CLI, manifest/UI, lifecycle, and non-interactive integration coverage without changing vendor protocols or adding a generic plugin system.
- Builds on `simplify-watch-shutdown-lifecycle`'s cached aggregate contribution disposer and single root signal/terminal ownership, and preserves `add-compile-watch-terminal-output`'s distinction between raw task output and structured orchestration state.

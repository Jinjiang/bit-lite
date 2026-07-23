## Purpose

Define observable, terminal-safe, and failure-safe progress behavior for `bit-lite install`.

## Requirements

### Requirement: Install reports its lifecycle phases
`bit-lite install` SHALL report visible lifecycle state for workspace discovery, dependency installation, component linking, and optional one-shot compilation. The command SHALL announce a potentially slow phase before awaiting it and SHALL identify successful completion with the relevant observed component or package count. It MUST NOT report the compile phase when `--compile` is not enabled.

#### Scenario: Install runs without compilation
- **WHEN** a user runs `bit-lite install` without `--compile`
- **THEN** the command reports workspace, dependency, and linking progress in execution order and does not report a compile phase

#### Scenario: Install runs with compilation
- **WHEN** a user runs `bit-lite install --compile`
- **THEN** the command reports compilation after dependency installation and linking and completes that phase with the compiled component count

#### Scenario: A phase is slow
- **WHEN** dependency installation, linking, or compilation remains pending
- **THEN** the user has already received output identifying the active phase

### Requirement: Dependency progress reflects observed pnpm work
During dependency installation, Bit-lite SHALL present available dependency stage transitions and aggregate resolved, reused, downloaded, and added or imported counts derived from observed pnpm work. Counter updates MUST be deduplicated or throttled sufficiently to avoid one durable output line per raw package event, while the last observed counters SHALL be presented before successful phase completion. Bit-lite MUST NOT claim a percentage complete or ETA when pnpm has not supplied a fixed total.

#### Scenario: Dependencies are downloaded
- **WHEN** pnpm resolves and fetches packages during installation
- **THEN** dependency status advances through the observed stages and reports increasing resolved and downloaded counters without inventing a percentage or ETA

#### Scenario: Dependencies are satisfied from the store
- **WHEN** an install reuses cached packages and downloads none
- **THEN** dependency status reports the observed reuse and zero-download work and still reaches successful completion

#### Scenario: pnpm emits repeated progress records
- **WHEN** multiple raw pnpm records do not change the aggregate dependency counters
- **THEN** Bit-lite does not emit duplicate durable counter snapshots for those records

### Requirement: Install presentation adapts to the progress stream
Install lifecycle and dependency progress SHALL be written to stderr. When the progress destination is an interactive TTY, Bit-lite SHALL use one replaceable active status line and leave completed phases as durable lines. When the destination is non-interactive, Bit-lite SHALL emit append-only newline-delimited records without ANSI cursor control, carriage-return rewriting, or animation. Existing final installed, linked, and compiled summaries SHALL remain on stdout.

#### Scenario: Install runs in an interactive terminal
- **WHEN** stderr is connected to a TTY
- **THEN** changing dependency counters update the active status line and completed phases remain readable after the command exits

#### Scenario: Install runs in CI
- **WHEN** stderr is not connected to a TTY
- **THEN** install progress is emitted as append-only `[install]` records containing no terminal rewrite sequences

#### Scenario: Standard output is redirected
- **WHEN** stdout is redirected but stderr remains connected to a TTY
- **THEN** interactive progress remains on stderr and the existing final summaries are written to redirected stdout

### Requirement: Install diagnostics remain visible
Warnings and dependency request retries observed during installation SHALL be emitted as durable stderr records without waiting for progress throttling. Expected optional dependency skips caused by packages targeting other platforms SHALL be deduplicated and summarized once instead of being emitted as one warning per package variant. Interactive presentation SHALL clear the transient status before a diagnostic and restore the active phase afterward. A failed phase SHALL be identified, while the original exception, top-level error message, and nonzero exit behavior remain authoritative.

#### Scenario: A dependency request is retried
- **WHEN** pnpm reports a registry request retry while dependency progress is active
- **THEN** Bit-lite writes a durable retry notice and continues displaying the current dependency phase

#### Scenario: Optional packages target other platforms
- **WHEN** pnpm skips multiple optional dependency variants because they target unsupported operating systems, CPU architectures, or libc implementations
- **THEN** Bit-lite writes one durable summary containing the number of unique skipped package variants and does not print their raw platform warnings individually

#### Scenario: Dependency installation fails
- **WHEN** pnpm rejects dependency installation
- **THEN** Bit-lite finalizes the active phase as failed, preserves the original error for the CLI error path, and does not print a successful install summary

#### Scenario: Compilation fails
- **WHEN** `install --compile` reaches compilation and a configured compiler fails
- **THEN** Bit-lite marks compilation as failed and preserves the existing compilation failure details and command exit behavior

### Requirement: Dependency reporting is scoped and disposable
The dependency layer SHALL expose a Bit-lite-owned progress event contract rather than pnpm log object types. Any listener attached to pnpm's process-global logger for one dependency installation SHALL filter scoped records to that installation root where scope data is available and MUST be removed after worker cleanup is attempted on every success or failure path. Unknown pnpm records SHALL be ignored without failing installation.

#### Scenario: Dependency installation succeeds
- **WHEN** `installDependencyProjects` completes normally
- **THEN** its pnpm logger listener is removed and a later in-process operation does not receive duplicate progress through that listener

#### Scenario: Dependency installation throws
- **WHEN** pnpm setup, mutation, or worker cleanup throws
- **THEN** the logger listener is still removed and the underlying error remains observable

#### Scenario: pnpm emits an unknown record
- **WHEN** the pinned pnpm stack or a later compatible version emits an unrecognized logger record
- **THEN** the adapter ignores that record without exposing it through the public progress contract or aborting installation

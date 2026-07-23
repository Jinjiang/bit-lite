## Context

`runInstallCommand` currently awaits workspace reading, generated dependency-project creation, containing-pnpm-workspace discovery, `mutateModules`, component linking, and optional one-shot compilation before printing its existing summaries. Dependency installation is the longest opaque interval. `bit-lite-deps` already depends directly on `@pnpm/logger`, and pnpm emits structured stage, progress, statistics, warning, and retry records while `mutateModules` runs, but no reporter subscribes to them.

The pnpm logger stream is process-global and its record shapes are pnpm-specific. Presentation also has two distinct consumers: an interactive terminal can update one status line, while CI and redirected streams need durable newline-delimited output. Install progress must therefore cross a narrow package boundary and be cleaned up carefully without changing install behavior.

## Goals / Non-Goals

**Goals:**

- Make every potentially slow install phase visible before it begins and after it completes.
- Show real dependency stage and counter information when pnpm provides it.
- Give interactive and non-interactive consumers appropriate output from the same command lifecycle.
- Preserve existing summaries, exceptions, exit codes, installation order, and `--compile` one-shot behavior.
- Keep pnpm log schemas and process-global subscription details inside `bit-lite-deps`.

**Non-Goals:**

- Estimate a completion percentage, remaining duration, or ETA.
- Reproduce pnpm's full default reporter or expose every package-level record.
- Add per-component one-shot compiler progress in the first version.
- Add reporter-selection, verbosity, color, or quiet CLI options.
- Reuse the resident managed terminal used by watch commands.

## Decisions

### 1. Adapt pnpm logs to a Bit-lite-owned dependency progress contract

`InstallDependencyProjectsOptions` will accept an optional synchronous `onProgress` callback. `bit-lite-deps` will translate relevant `@pnpm/logger` records into a discriminated `DependencyInstallProgressEvent` union covering dependency stage transitions, aggregate counters, warnings, and request retries. Raw pnpm log objects will not cross the package boundary.

The adapter will aggregate unique resolution, store-reuse, fetch, and import observations before emitting counter snapshots. Stage records will represent resolution and import start/completion. Records with a `prefix` or `requester` will be filtered to the requested dependency install root.

Alternative considered: initialize `@pnpm/default-reporter` directly. That would provide rich output quickly, but it would expose generated `.bit-lite/deps` projects, duplicate Bit-lite summaries, give pnpm control over terminal presentation, and add a direct dependency on a larger reporter stack. A stable event contract keeps Bit-lite's output intentional and testable.

### 2. Keep phase orchestration and rendering in the install command package

The command layer will own an `InstallReporter` abstraction with operations for starting, updating, completing, and failing a phase. `runInstallCommand` will report these phases in execution order:

1. read the workspace and count canonical components;
2. prepare generated dependency projects and discover local fallback packages;
3. install dependencies, incorporating dependency progress events;
4. link component packages;
5. when requested, compile component packages once.

Preparation may be presented as part of the dependency phase rather than as a separate user-facing phase if it completes immediately. Optional compilation will report only its phase start and final compiled count; per-component progress would require a separate observer contract on generic one-shot vendor execution and is deferred.

Alternative considered: print `console.log` calls around each existing `await`. That would improve the silent periods but would mix output policy with orchestration, make TTY rewriting difficult, and leave pnpm progress inaccessible.

### 3. Select one-line or append-only rendering from the destination stream

Progress output will use stderr, while the existing final install, link, and compile summaries remain on stdout. When the injected progress stream is a TTY, the reporter will keep one replaceable status line and turn phase completion into a durable completed line. Before emitting a warning or retry, it will clear the transient line, write the diagnostic, and then restore the current status.

When stderr is not a TTY, the reporter will emit append-only `[install]` records with no carriage returns, cursor-control sequences, or animation. It will log phase transitions and throttled or changed counter snapshots rather than every raw pnpm event. Selecting from the actual destination stream allows stdout to be redirected without disabling useful terminal progress on stderr.

Alternative considered: always use a spinner. Spinner control sequences make redirected logs unreadable and an animation timer adds lifecycle work without conveying more truth than event-driven status updates.

### 4. Report only observed work

Dependency status may show `resolved`, `reused`, `downloaded`, and `added`/`imported` counters derived from observed pnpm records. It will not convert those counters into a percentage because the final dependency total is not known during resolution. A fully cached install remains meaningful by reporting reuse and completion even when the downloaded count is zero.

Warnings and retry notices bypass progress throttling. Counter snapshots may be coalesced to limit terminal writes, but the last observed snapshot will be rendered before the dependency phase completes.

Pnpm's install-check logger also emits one warning for every optional native package variant that does not match the current platform. These are expected selection records rather than actionable diagnostics. The dependency adapter will recognize the structured install-check source plus its unsupported-platform message, deduplicate package ids, and expose a cumulative optional-skip count. The reporter will keep that count silent during installation and write one durable summary immediately before the dependency phase completes. Other install-check warnings remain immediate diagnostics.

### 5. Scope and dispose the process-global logger subscription

`installDependencyProjects` will attach the pnpm stream listener only when `onProgress` is provided, before pnpm configuration/store setup, and remove it in `finally` after worker shutdown has been attempted. Listener removal will occur on success, pnpm failure, callback/rendering failure, and worker cleanup failure.

The install reporter will also finalize or clear its active line in `finally`. It will never replace the original install exception with a presentation-only failure, and the existing top-level CLI error path remains responsible for the detailed final error message and nonzero exit.

Alternative considered: leave one shared listener installed for the process lifetime. That risks duplicate output across repeated in-process commands and leaks test state.

## Risks / Trade-offs

- **[pnpm logger record shapes change with a dependency upgrade]** → Keep parsing inside `bit-lite-deps`, narrow records defensively, ignore unknown records, and cover known pinned-version shapes with unit tests.
- **[The global logger includes unrelated concurrent pnpm activity]** → Filter scoped records by the dependency root and keep the subscription lifetime limited to one install call; document that unscoped pnpm diagnostics are only observed during that call.
- **[High-frequency progress events produce noisy CI logs]** → Deduplicate aggregate snapshots and throttle non-terminal counter lines while always flushing the final state.
- **[Platform-specific optional dependencies produce dozens of warnings]** → Classify unsupported-platform install-check records, deduplicate package ids, and replace their raw messages with one phase-end summary.
- **[A warning corrupts an interactive status line]** → Clear the transient line before the warning and render the active phase again afterward.
- **[Terminal output code affects install correctness]** → Inject and unit-test the reporter, keep it dependency-free, and ensure listener and terminal cleanup cannot swallow the underlying install error.
- **[Compilation can still be silent within its phase]** → Show the planned component count and phase ownership now; consider one-shot vendor execution observers separately if real installs demonstrate a need for per-component detail.

## Migration Plan

No persisted data or configuration migration is required. Add the dependency event adapter and tests first, then the two reporter modes, and finally connect phase reporting in `runInstallCommand`. Existing install summaries provide a compatibility assertion. Rollback consists of removing the optional callback and reporter calls; dependency installation artifacts and lockfiles are unchanged.

## Open Questions

None for the first version. Reporter flags and per-component compile progress are deliberately deferred until the default behavior has been observed in real workspaces.

## 1. Dependency Progress Events

- [x] 1.1 Define the Bit-lite-owned dependency progress event union and optional `onProgress` installation callback without exporting pnpm logger types.
- [x] 1.2 Implement defensive pnpm stage, progress, warning, retry, and statistics adaptation with install-root filtering, unique counter aggregation, changed-snapshot deduplication, and unknown-record tolerance.
- [x] 1.3 Attach the pnpm stream listener for the complete dependency installation lifecycle and remove it after worker cleanup on success, setup failure, mutation failure, callback failure, and cleanup failure.
- [x] 1.4 Add focused `bit-lite-deps` tests for downloaded and cached counters, repeated and unknown records, root filtering, diagnostics, listener disposal, and preservation of underlying failures.

## 2. Install Output Reporter

- [x] 2.1 Add an injectable install reporter that writes progress to stderr and supports phase start, dependency update, durable diagnostic, success, failure, and final line cleanup.
- [x] 2.2 Implement TTY rendering with one replaceable active line, durable completed phases, and diagnostic clear/restore behavior without adding a resident managed terminal or animation timer.
- [x] 2.3 Implement non-TTY `[install]` append-only rendering with changed/throttled counter snapshots, a final counter flush, and no carriage-return or cursor-control sequences.
- [x] 2.4 Add reporter tests covering interactive replacement, non-interactive durability, cached zero-download output, warnings and retries, phase failure, final cleanup, and independence from stdout redirection.

## 3. Install Command Integration

- [x] 3.1 Connect workspace, dependency preparation/installation, linking, and optional one-shot compilation phases to the reporter in their existing execution order.
- [x] 3.2 Forward dependency progress events into the active phase, report observed component and package counts, omit compilation output without `--compile`, and retain the existing stdout summary text.
- [x] 3.3 Finalize failed phases without swallowing or replacing workspace, pnpm, link, compile, or top-level CLI errors and without printing later successful summaries.
- [x] 3.4 Extend install command tests for phase ordering, compile enabled/disabled behavior, TTY and CI routing, redirected stdout, dependency and compiler failures, and unchanged success summaries.

## 4. Verification

- [x] 4.1 Run the focused `bit-lite-deps` and `bit-lite` test suites, package typechecks, and builds.
- [x] 4.2 Exercise `bit-lite install` and `bit-lite install --compile` in interactive and redirected/non-interactive modes against the demo workspace and confirm readable progress, final summaries, and failure cleanup.

## 5. Platform Skip Summary

- [x] 5.1 Classify unsupported-platform install-check warnings in `bit-lite-deps`, deduplicate package ids, and expose a cumulative optional-skip progress event while preserving ordinary warnings.
- [x] 5.2 Aggregate optional platform skips in the install reporter and flush exactly one durable summary before dependency completion in interactive and non-interactive output.
- [x] 5.3 Add focused adapter and reporter tests, then rerun package tests, typechecks, builds, and the demo install command.

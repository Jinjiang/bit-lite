## Context

Maintained TypeScript and environment compiler vendors share `startCompilerWatch`. The helper already emits structured `ready`, `status`, `result`, and `error` messages, but it does not write to stdout or stderr. In worker mode, those two channels are captured by the generic runner, appended to each `VendorTask.rawOutput`, and replayed by `ManagedTerminal` when a user opens a task. Because the maintained helper writes nothing, the capture and replay path is working with an empty buffer.

The first version should make watch activity observable without introducing another reporting abstraction or changing the vendor message contract. Compiler diagnostics can be multiline and may contain ANSI formatting, so the output path must preserve the compiler-provided text.

## Goals / Non-Goals

**Goals:**

- Ensure every initial or subsequent maintained watch compile produces visible progress and success output.
- Ensure compile failures and watcher-level failures expose their diagnostic details in the component terminal.
- Keep raw output additive to structured messages, with structured messages remaining authoritative for orchestration and task state.
- Preserve failed-rebuild recovery and make a later successful rebuild visible in the same task.
- Reuse the existing worker stdout/stderr capture, bounded raw-output buffer, and terminal replay behavior.

**Non-Goals:**

- Defining a stable machine-readable log format or parsing terminal text in core.
- Adding a logging framework, timestamps, attempt identifiers, verbosity settings, or output collapsing.
- Changing `VendorMessage`, runner, `VendorTask`, `RawOutputBuffer`, or `ManagedTerminal` APIs.
- Changing third-party compiler behavior or one-shot compiler output.
- Redesigning compile watch lifecycle, shutdown ownership, or task supervision.

## Decisions

### 1. Emit output in the shared maintained watch helper

`startCompilerWatch` will write the output because it owns the common attempt lifecycle and has the component identity and formatted failure. The maintained TypeScript and environment vendors therefore receive consistent behavior without duplicating logging around their separate `compileOnce` functions.

Each attempt will use `console.log` for a concise progress message before compilation and a concise completion message after success. Both messages will identify `component.id`. A failed attempt will use `console.error` for a failure heading with the same component identity followed by the full formatted diagnostic.

The initial wording is intentionally human-readable rather than a stable public format. Tests will assert the event meaning, component identity, and diagnostic preservation rather than exact punctuation.

Alternative considered: log in `runCompileCommand` or the supervisor. That layer sees structured lifecycle messages but does not own compiler diagnostics and would duplicate or reconstruct vendor behavior. It would also make caller-owned compile contributions behave differently from the standalone command.

### 2. Keep terminal output and structured messages as parallel channels

The helper will continue posting the existing structured messages. Raw output will not be parsed, used to update task state, or accepted as a compile result. On a failure, the error will be formatted once and the same diagnostic body will be sent to stderr and in the structured error message.

There is no ordering guarantee between worker stdio and worker message-port delivery. Consumers may rely on the content of each channel, but not on a strict cross-channel sequence.

Alternative considered: replace structured errors with stderr. This was rejected because task state, startup failure handling, contribution readiness, and composition depend on structured messages.

### 3. Use stdout for lifecycle progress and stderr for failures

Normal attempt start and success output goes to stdout. Compile failures and watcher-level errors go to stderr. A failed compile does not emit a success message, does not stop the watcher, and does not discard earlier output. After source correction, the next attempt emits normal stdout progress/success output and a structured result on the same task.

Watcher-level errors use a distinct human-readable heading so they are not confused with compiler diagnostics, while retaining the existing structured error emission. Whether a watcher-level error is fatal during startup or recoverable after readiness remains governed by the existing watcher lifecycle.

Alternative considered: send all text to stdout for simplicity. This was rejected because preserving stderr lets terminals and non-interactive consumers distinguish diagnostics using the existing stream metadata.

### 4. Reuse existing raw-output capture and retention

No terminal or runner changes are required. In worker-backed watch tasks, `console.log` and `console.error` flow through worker stdout/stderr, runner output listeners, and the task's bounded `RawOutputBuffer`. Opening a component terminal replays retained entries and then displays live output.

The existing buffer limit remains authoritative; this change does not promise unbounded watch history. The messages are deliberately concise so long-running sessions consume little additional buffer space.

Alternative considered: add log entries directly to `VendorTask.rawOutput` from compile orchestration. This was rejected because it couples a service-specific command to terminal storage and bypasses the generic worker-output path.

## Risks / Trade-offs

- [Long-running watch sessions add repetitive progress lines] → Keep each attempt to one start line and one success line, while relying on the existing bounded buffer.
- [Structured and raw error information is duplicated] → Treat the duplication as intentional: structured errors drive orchestration, while stderr serves human diagnosis.
- [Worker stdio and structured messages can arrive in different orders] → Avoid cross-channel ordering requirements and tests.
- [Compiler diagnostics can contain multiline or ANSI content] → Preserve the formatted diagnostic rather than normalizing or truncating it in the watch helper.
- [Direct helper tests write to the test process console] → Capture console methods in focused tests and restore them after each assertion.

## Migration Plan

1. Add focused output assertions for successful initial/rebuild attempts, failed rebuilds, recovery, and watcher errors.
2. Add the minimal stdout/stderr writes to the shared maintained compiler watch helper while retaining all existing structured messages.
3. Verify that worker-backed task output reaches the existing raw-output buffer and is available to terminal replay.
4. Run the focused `demo-vendors` and compile command tests plus relevant type checks.

There is no persisted-data or API migration. Rollback removes the new writes and their assertions.

## Open Questions

None for the first version. Formatting, verbosity controls, deduplication, or richer compiler-native progress can be proposed separately after observing real watch usage.

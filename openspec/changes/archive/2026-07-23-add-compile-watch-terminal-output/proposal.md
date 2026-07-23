## Why

`compile --watch` currently emits structured vendor messages but produces no human-readable stdout or stderr, so an attached per-component terminal remains blank during normal compilation and often provides no useful compiler detail when a rebuild fails. Watch tasks need a small, explicit raw-output contract so developers can see progress, success, and failure details without weakening the structured protocol used for orchestration.

## What Changes

- Require maintained compiler watch vendors to write concise progress and successful-completion messages to stdout for every compile attempt.
- Require watch failures, including compiler and watcher-level failures, to write component-identified diagnostic details to stderr.
- Keep structured status, result, and error messages as the authoritative machine-readable contract; raw terminal output is additive observability only.
- Preserve the existing long-lived recovery behavior: a failed rebuild remains visible, the watcher stays alive, and a later successful rebuild reports both terminal output and a validated result.
- Limit the new output behavior to watch mode; one-shot compile output is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `compile-command`: Define the stdout/stderr behavior of maintained compile watch vendors and its relationship to structured vendor messages and watcher recovery.

## Impact

- Affects the shared compiler watch helper used by maintained TypeScript and environment compiler vendors.
- Affects compile watch integration tests and terminal-output assertions.
- Adds human-readable output to existing vendor-task raw-output buffering and managed terminal presentation; it does not change vendor message shapes, service contracts, dependencies, or one-shot compile behavior.

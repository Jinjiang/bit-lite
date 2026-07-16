## Why

Developers currently have to run `preview` and `test --watch` as separate processes, even though both commands operate on the same selected components and need the same long-lived task, terminal, and status infrastructure. A `start` command can provide one development entry point while establishing a small, reusable composition boundary for future long-running commands.

## What Changes

- Add a `start` CLI command that prepares one canonical workspace selection and runs its preview and test services together in watch mode.
- Let long-running child commands contribute their vendor tasks, proxy routes/read models, and cleanup work without creating their own managed terminal or listening proxy server.
- Run all preview and test tasks in one centrally managed terminal and coordinate shutdown from `start`.
- Split the current preview proxy responsibilities into reusable server/route primitives and preview-specific routing and state so standalone `preview` and composed `start` can share the implementation.
- Serve a central development UI and manifest that retain preview links and add read-only component test-result pages.
- Show the latest structured test result for the selected component together with the latest env-level terminal output, clearly noting that the output may include other components in the same env and represents the latest observed update.
- Use the structured selected-env identity (`packageName`, `requestedVersion`, and `installedVersion`) in composed manifests and result responses, while retaining the declaring service source for vendor/config resolution.
- Keep the initial test UI read-only: it will not expose rerun buttons, tester-control messages, or action/capability APIs.
- Preserve the existing standalone behavior of `preview` and `test`, with their own terminal and lifecycle coordination when invoked directly.

## Capabilities

### New Capabilities

- `start-command`: Defines command composition, centralized task and proxy ownership, combined preview/test discovery, and read-only component test-result routes.

### Modified Capabilities

None. Existing preview behavior remains externally compatible; its proxy and task-lifecycle changes are implementation refactoring used by the new capability.

## Impact

- Affects CLI registration and command orchestration in `packages/bit-lite`.
- Adds a small `bit-lite-proxy` package for generic HTTP/WebSocket route registration and reverse-proxy transport.
- Aligns command composition with the canonical `Workspace`, `WorkspaceContext`, and derived env-group model so preview and test contributions share one prepared selection rather than reloading it independently.
- Refactors watch-task creation and lifecycle ownership in `packages/bit-lite-vendors` around parent-owned `VendorContext` data and its use of `bit-lite-terminal`.
- Refactors `packages/bit-lite-preview` proxy state, HTTP/WebSocket routing, and shell responsibilities into reusable and preview-specific layers.
- Extends test watch result storage and output capture to support component-scoped structured reads and env-scoped terminal reads.
- Adds central UI assets, manifest/result routes, integration tests, and command help documentation.

## Why

Small utility functions are duplicated across many production TypeScript files and have begun to drift into multiple behavioral variants. Consolidating the selected functions gives the workspace one intentional source of truth while preserving the behavior that each current call site relies on.

## What Changes

- Add a private workspace package named `bit-lite-utils` for reusable, dependency-light TypeScript utilities.
- Consolidate the 28 selected production utility function families: `isRecord`, `isInteractiveTerminal`, `isNodeErrorCode`, `isJsonObject`, `sanitizeFileName`, `createComponentFileMap`, `formatExitCode`, `isFile`, `isFileUrl`, `listen`, `normalizeFilePath`, `readStringRecord`, `replaceExtension`, `sortStringRecord`, `toPosixPath`, `throwCombinedErrors`, `formatError`, `isJsonValue`, `collectFiles`, `readHost`, `readPort`, `escapeHtml`, `isPortUnavailableError`, `isVendorDefinition`, `readDefaultExport`, `readJsonFile`, `readPackageName`, and `sendHtml`.
- Consolidate every `readHost` and `readPreviewHost` implementation behind one shared host parser while preserving the existing exported preview API.
- Consolidate every `readPort` and `readPreviewPort` implementation behind one shared port parser while preserving the existing exported preview API and each caller's accepted input and error behavior.
- Make `bit-lite-vendors` the canonical owner of `isVendorDefinition`; other packages SHALL consume that implementation instead of adding a vendor-domain dependency to `bit-lite-utils`.
- Preserve intentional differences in error formatting, combined-error deduplication, JSON validation, filesystem traversal, port parsing, HTML escaping, module export reading, JSON reading, package-name validation, HTTP responses, and similar variant behavior through explicit shared APIs instead of silently changing consumers.
- Replace the selected non-test local implementations with imports from `bit-lite-utils` or the canonical `bit-lite-vendors` predicate owner, and declare workspace dependencies in every consuming package.
- Add focused utility tests and verify all affected package tests, typechecks, and builds.
- Leave test-only helpers, `compileOnce`, the private `isWorkerRunnerShutdownMessage` worker-protocol predicate, and differently named duplicate functions other than the explicitly included `readPreviewHost` and `readPreviewPort` aliases out of scope.

## Capabilities

### New Capabilities

- `shared-utility-library`: Defines the reusable utility package, its runtime boundaries, behavior-preserving APIs, and adoption by production consumers.

### Modified Capabilities

None.

## Impact

- Adds `packages/bit-lite-utils` and updates the pnpm lockfile and workspace package dependency graph.
- Requires the implementation worktree to include `codex/simplify-watch-shutdown-lifecycle` commit `c84c6a3` before utility migration begins.
- Affects production sources and package manifests in `bit-lite`, `bit-lite-compiler`, `bit-lite-context`, `bit-lite-deps`, `bit-lite-env`, `bit-lite-preview`, `bit-lite-proxy`, `bit-lite-vendors`, `demo-config`, and `demo-vendors`.
- Expands the public surface of `bit-lite-vendors` with its canonical `isVendorDefinition` predicate and retains compatibility exports for preview host and port readers.
- Introduces shared browser-safe and Node-specific utility entry points; no externally observable runtime behavior is intended to change.
- Removes selected duplicated local implementations after their consumers migrate to the shared package.

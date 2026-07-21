## Why

`bit-lite start` already provides one place to inspect a selected component's previews and test results, but developers must leave that UI to find and read the component's source files. Adding a safe, read-only source browser makes the start page a complete inspection entry point while preserving the command's filtered workspace boundary.

## What Changes

- Add a start-owned source browser page for every selected component, with a navigable file tree and text-file viewer.
- Add read-only source index and file-content routes that read current files from the component root, exclude dependency/build directories and symlinks, and reject paths outside the selected component.
- Add a source-route descriptor to every component in the combined start manifest and render a `source` entry beside its preview and test links on the start homepage.
- Return controlled states for missing, binary, oversized, removed, or otherwise unavailable files without exposing arbitrary workspace paths or absolute filesystem paths.
- Keep source reads live and uncached so subsequent requests reflect edits made while `bit-lite start` is running.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `start-command`: Extend the combined start navigation and read-only development UI with safe per-component source browsing for the current canonical selection.

## Impact

- Affects `packages/bit-lite/src/commands/start.ts`, a new start source-route/read-model module, start HTML assets, and start route/unit/end-to-end tests.
- Extends the public start manifest component shape and adds new start-only HTTP GET routes; no CLI flags, env contracts, vendor protocols, or external runtime dependencies are added.
- Source access remains limited to components selected by the existing workspace/filter resolution and does not affect standalone `preview` or `test --watch` behavior.

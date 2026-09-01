## Why

Bit Lite currently delegates source history to the workspace VCS and has no component-level snap, tag, or shared history model. A dedicated Git-backed component store can add independently versioned component histories without coupling them to the user's source repository or reimplementing content-addressed storage and transport from scratch.

## What Changes

- Add a durable hidden bare Git repository, separate from the disposable `.bit-lite` cache, as the local component history store.
- Represent every registered component with its own linear Git commit history and use each component commit OID as its snap ID.
- Add a `snap` command that captures the complete component-owned regular-file tree, including source, docs, demos, tests, assets, dotfiles, and the current `.comp.json`, while pruning generated and internal directories and refusing unsafe symbolic-link traversal.
- Record the current component state as a commit whose first parent is the previous snap of that same component, and advance only that component's ref.
- Add component-prefixed annotated Git tags that assign immutable semantic tags to existing component snaps.
- Add explicit synchronization of component refs and tags with a configured Git remote, including fast-forward updates, idempotency, divergence detection, and atomic multi-ref publication when supported.
- Keep v1 intentionally narrow: it will not infer dependencies, capture resolved env or workspace policy outside the component directory, include build artifacts or caches, merge divergent component histories, or implement checkout/import/export workflows.

## Capabilities

### New Capabilities

- `component-snapshot-history`: Defines the durable local Git store, per-component histories, complete component file capture, snap identity, and safe local ref updates.
- `component-version-tags`: Defines immutable component-prefixed semantic tags that point to existing snaps.
- `component-history-sync`: Defines remote configuration and Git-based synchronization of component histories and tags, including conflict and atomicity behavior.

### Modified Capabilities

None. Existing workspace loading, development commands, and generated dependency/cache behavior remain externally compatible.

## Impact

- Adds `snap`, `tag`, and `sync` command behavior to `packages/bit-lite` and its CLI help.
- Reuses canonical component identity and filtering from `bit-lite-context`, and adds a deterministic component file snapshot boundary consistent with workspace safety rules.
- Introduces a Git process adapter and durable bare-repository lifecycle, ref naming, object creation, tagging, fetch, and push behavior.
- Requires Git to be available for the new versioning commands, while existing install, link, compile, test, preview, and start commands remain independent of the component store.
- Changes demo workspace ignore/cleanup conventions so the durable store is ignored by the source repository but never removed as disposable `.bit-lite` state.
- Adds unit and isolated real-Git integration tests for snapshot identity, per-component history, file inclusion, tags, remote synchronization, divergence, and failure recovery.

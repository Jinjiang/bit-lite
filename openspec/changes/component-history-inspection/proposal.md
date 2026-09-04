## Why

Bit Lite can now record component history, but it can only write it. There is no way to ask what a component's current state is, what versions it has, or what changed between two of them. The only inspection path is running raw Git plumbing against `.bit-lite-store.git`, which requires knowing the ref encoding and reading a projected `.comp.json` out of a commit by hand.

This gap is sharper than it looks because `dependency-aware-versioning` makes a component's recorded content depend on its dependencies and its env. A component now gets a new version when a dependency or env moves, with no visible change anywhere in the working tree. That behavior is correct and matches Bit, but it is only acceptable if the tooling can explain it. Today it cannot.

There is also a hazard nobody can currently see: `sync` can fast-forward a component's canonical head without touching working files, after which the working tree is based on an ancestor of the head it would be recorded against.

## What Changes

- Add `bit-lite status`: for each selected component, report whether it has ever been recorded, whether its working content differs from its recorded head, whether it has a snap but no released version, whether its working tree is based on an older version than the head, and whether any of its workspace dependencies have newer versions than the ones its head records.
- Add `bit-lite log`: walk a component's linear history from its canonical head, decorated with the semantic versions tagged on each snap.
- Attribute every recorded version to a change source — `source`, `deps`, `env`, or a combination — so a version produced by a dependency or env moving is explainable without opening the store.
- Add `bit-lite diff`: compare a component between two points, defaulting to working state against its recorded head, and also accepting two recorded versions.
- Present `.comp.json` changes semantically as dependency and env version changes rather than as a raw JSON text diff, and present all other files as ordinary file changes.
- Guarantee that `diff` reports no changes for exactly those components `snap` would report as unchanged, so the two commands cannot disagree — including when a component's own files are untouched but one of its workspace prerequisites has changed, which is reported by propagating modification over the prerequisite graph rather than by predicting a version that does not exist yet.
- Report rather than refuse when a workspace prerequisite is unrecorded or has uncommitted changes, unlike the recording commands, so inspection answers in exactly the situations that make it worth running.
- Add a way to compute a component's candidate tree without writing objects, so read-only inspection never leaves unreachable blobs and trees in the store.

## Capabilities

### New Capabilities

- `component-history-inspection`: Defines the read-only inspection surface over component history — component status against the store, history listing with version decoration and change-source attribution, comparison between working state and recorded versions, semantic presentation of component metadata changes, how inspection resolves dependency versions without refusing, and the requirement that inspection never mutates the store.

### Modified Capabilities

None. Recording behavior, the store layout, tag semantics, and synchronization are unchanged; this change only reads what they produce.

## Impact

- `packages/bit-lite-history`: gains history walking, an authored timestamp on the existing commit reader, tree comparison, and a compute-only tree path. That path is the largest single piece of work here: blobs can be hashed without `-w`, but Git offers no read-only `write-tree`, so trees must be serialized and hashed in process. Per-component tag lookup is not new — `listComponentVersionRefs` already peels annotated tags and is reused as-is. Existing recording paths keep writing objects as they do now.
- `packages/bit-lite/src/commands`: adds `status.ts`, `log.ts`, and `diff.ts`, and registers all three in the CLI and its help.
- Reuses the projection introduced by `dependency-aware-versioning` so working state and recorded state are always compared in the same form; this change does not define its own projection. It does not reuse that change's prerequisite *policy*, which refuses an unrecorded or dirty prerequisite — inspection resolves each prerequisite to its own head version and reports instead.
- Reuses the existing component selection and filter conventions, so all three commands accept the same `--filter` arguments as other workspace commands, and reads the workspace the way `snap` does, without resolving envs or requiring an install.
- Adds unit tests for change-source attribution and metadata-change presentation, and integration tests over real bare repositories for status states, history listing, diffs across working state, snaps, and tags, and for the tree serializer agreeing with Git.
- Updates the root README and `packages/bit-lite/README.md`; the latter also carries stale `snap` and `tag` descriptions left by `dependency-aware-versioning`, corrected here since these commands land on the same page.

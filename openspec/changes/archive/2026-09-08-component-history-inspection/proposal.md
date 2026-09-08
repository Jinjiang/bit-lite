## Why

Bit Lite can now record component history, but it can only write it. There is no way to ask what a component's current state is, what versions it has, or what changed between two of them. The only inspection path is running raw Git plumbing against `.bit-lite-store.git`, which requires knowing the ref encoding and reading a projected `.comp.json` out of a commit by hand.

This gap is sharper than it looks because `dependency-aware-versioning` makes a component's recorded content depend on its dependencies and its env. A component now gets a new version when a dependency or env moves, with no visible change anywhere in the working tree. That behavior is correct and matches Bit, but it is only acceptable if the tooling can explain it. Today it cannot.

There is also a hazard nobody can currently see: `sync` can fast-forward a component's canonical head without touching working files, after which the working tree is based on an ancestor of the head it would be recorded against.

## What Changes

- Add `bit-lite status`: for each selected component, report whether it has ever been recorded, whether its working content differs from its recorded head, whether it has a snap but no released version, whether its working tree is based on an older version than the head, and whether any of its workspace dependencies have newer versions than the ones its head records.
- Add `status --detail`: expand each reported component's **modified** condition into the component-owned files that differ and the dependency, env, and other metadata changes behind it. This is the semantic account of what recording would capture, and it always compares projected working content against the recorded head — naming two recorded versions is `log`'s territory, since `log` already reports each snap against its parent.
- Add `bit-lite log`: walk a component's linear history from its canonical head, decorated with the semantic versions tagged on each snap.
- Attribute every recorded version to a change source — `source`, `deps`, `env`, or a combination — so a version produced by a dependency or env moving is explainable without opening the store.
- Add `bit-lite diff`: emit a line-by-line unified diff of component content between two points, defaulting to working state against the recorded head and also accepting two recorded versions. The output follows the `diff --git` conventions editors already highlight and `*.diff` files already carry, so a redirected diff is a usable patch file rather than a transcript.
- Address patch paths in the workspace's own vocabulary, as `a/<component-id>::<path>`, so every path names the component it belongs to and two components owning a file of the same name never collide in one patch. `diff` therefore follows the same selection conventions as `status` rather than requiring exactly one component; naming two recorded versions still requires a single component, because a version identifier is local to one component's history.
- Precede each component's patches with a banner naming the component and the two states being compared, so a multi-component patch is visually separated and each component's version transition is stated once rather than repeated on every file header. The banner uses characters that carry no meaning in unified diff, so it cannot be misread as a file marker or a deleted line.
- Present `.comp.json` changes semantically — as dependency and env version changes — wherever Bit Lite reports rather than reproduces: in `status --detail` and in `log`. The recorded file is a projection whose keys are sorted and whose `workspace:*` specifiers have been substituted, so a textual reading of it would report formatting as a version change.
- Include `.comp.json` as an ordinary file patch in `diff`, which reproduces content rather than reporting on it. A patch that silently omitted a file the snap actually records would be an incomplete account of the difference.
- Guarantee that `status` reports as modified exactly those components `snap` would act on, so the two commands cannot disagree — including when a component's own files are untouched but one of its workspace prerequisites has changed, which is reported by propagating modification over the prerequisite graph rather than by predicting a version that does not exist yet.
- State plainly that an empty `diff` does **not** carry that guarantee. A component modified only because a prerequisite is dirty has no content difference of its own, since inspection resolves that prerequisite to the version at its own head; there is nothing for a patch to show. `status` is the authority on what recording will act on, and `diff` writes any such advisory to standard error so redirected output stays a valid patch.
- Report rather than refuse when a workspace prerequisite is unrecorded or has uncommitted changes, unlike the recording commands, so inspection answers in exactly the situations that make it worth running.
- Add a way to compute a component's candidate tree without writing objects, so read-only inspection never leaves unreachable blobs and trees in the store.

## Capabilities

### New Capabilities

- `component-history-inspection`: Defines the read-only inspection surface over component history — component status against the store with an expanded detail view, history listing with version decoration and change-source attribution, unified-diff reproduction of component content between working state and recorded versions, semantic presentation of component metadata changes wherever Bit Lite reports rather than reproduces, how inspection resolves dependency versions without refusing, and the requirement that inspection never mutates the store.

### Modified Capabilities

None. Recording behavior, the store layout, tag semantics, and synchronization are unchanged; this change only reads what they produce.

## Impact

- `packages/bit-lite-history`: gains history walking, an authored timestamp on the existing commit reader, tree comparison, and a compute-only tree path. That path is the largest single piece of work here: blobs can be hashed without `-w`, but Git offers no read-only `write-tree`, so trees must be serialized and hashed in process. Per-component tag lookup is not new — `listComponentVersionRefs` already peels annotated tags and is reused as-is. Existing recording paths keep writing objects as they do now.
- `packages/bit-lite/src/commands`: adds `status.ts`, `log.ts`, and `diff.ts`, and registers all three in the CLI and its help. `status` carries the semantic comparison report behind `--detail`; `diff` carries patch generation and no longer reports conditions.
- `packages/bit-lite-history`: additionally gains reading a blob's bytes by object ID, which patch generation needs for the recorded side of a comparison. The working side is read from the component root, because the tree it belongs to was computed and never written — the same constraint that already forces entry-list comparison rather than tree-ID comparison.
- Adds line-level differencing and unified-diff serialization. Text is compared by line with the standard three lines of context; content that is not valid UTF-8 is reported as differing binary rather than rendered, as Git does.
- Reuses the projection introduced by `dependency-aware-versioning` so working state and recorded state are always compared in the same form; this change does not define its own projection. It does not reuse that change's prerequisite *policy*, which refuses an unrecorded or dirty prerequisite — inspection resolves each prerequisite to its own head version and reports instead.
- Reuses the existing component selection and filter conventions, so all three commands accept the same `--filter` arguments as other workspace commands, and reads the workspace the way `snap` does, without resolving envs or requiring an install.
- Adds unit tests for change-source attribution, metadata-change presentation, and unified-diff serialization, and integration tests over real bare repositories for status states and its detail view, history listing, patches across working state, snaps, and tags, and for the tree serializer agreeing with Git.
- Updates the root README and `packages/bit-lite/README.md`; the latter also carries stale `snap` and `tag` descriptions left by `dependency-aware-versioning`, corrected here since these commands land on the same page.

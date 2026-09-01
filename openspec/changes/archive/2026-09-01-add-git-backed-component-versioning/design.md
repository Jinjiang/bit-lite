## Context

Bit Lite currently discovers components from `.comp.json`, resolves workspace state through `bit-lite-context`, and writes generated or cached state under `.bit-lite`. It does not own component version history. Using the workspace source repository directly would make every component snap depend on the user's branch, index, commits, hooks, and remote policy. It would also make one component's history difficult to separate from unrelated workspace changes.

This change introduces an independent Git object database whose only purpose is Bit Lite component history. Git supplies content-addressed objects, commit ancestry, tags, validation, garbage collection, and remote transport, while Bit Lite defines the component-level data model and user workflow.

The first version has these settled product constraints:

- every component has its own commit history;
- a snap captures all component-owned regular files, including docs, demos, tests, assets, dotfiles, and `.comp.json`;
- workspace policy and computed metadata outside the component root are not captured;
- users interact through Bit Lite commands rather than operating the hidden repository directly;
- histories can be persisted and shared through a Git remote;
- divergent histories are surfaced, not automatically merged.

The durable history store must not use `.bit-lite`, because existing demo and development workflows treat that directory as disposable and remove it during cleanup.

## Goals / Non-Goals

### Goals

- Give each registered component a simple, inspectable, linear snap history independent of the workspace source repository.
- Make the Git commit object ID the stable identity of a snap.
- Produce deterministic component trees from a clearly defined file boundary.
- Make local multi-component snap publication transactional at the ref level.
- Provide immutable semantic tags scoped by component ID.
- Synchronize histories and tags through ordinary Git object and ref transport without force-updating shared state.
- Keep existing Bit Lite commands and `.bit-lite` cache behavior unchanged.
- Hide Git plumbing behind a narrow internal API so the storage mechanism can be tested with real isolated repositories.

### Non-Goals

- Capturing `bit-lite.json`, inferred dependencies, resolved environments, package-manager state, build artifacts, or caches in v1 snaps.
- Reproducing a component at a snap through checkout, import, export, or installation workflows.
- Automatically merging or rebasing divergent component histories.
- Replacing the user's source-control workflow or requiring a clean source worktree.
- Supporting lightweight tags, moving tags, force push, history rewriting, or deletion commands.
- Exposing the hidden repository as a public Bit Lite API.
- Supporting symbolic links in component snapshots in v1.
- Making one commit that groups changes to multiple components.

## Decisions

### 1. Use a dedicated bare repository at `.bit-lite-store.git`

The workspace owns one durable bare Git repository at `<workspace>/.bit-lite-store.git`. Versioning commands initialize it lazily with `git init --bare`; existing commands do not initialize or inspect it. The directory is ignored by the source repository but is never included in `.bit-lite` cleanup.

A bare repository avoids a second checked-out copy of every component and removes worktree/index state from the durable data model. It also makes the boundary from the source repository explicit: every Git invocation supplies the store path and never relies on Git's current-directory discovery.

Alternatives considered:

- **Private refs in the source repository:** rejected because snaps would still share object storage, config, hooks, remote policy, maintenance, and lifecycle with the user's repository.
- **A hidden branch in the source repository:** rejected because it couples versioning to source repository refs and makes branch/ref publication part of the user's Git surface.
- **A non-bare nested repository:** rejected because its worktree duplicates component files, can drift from refs, and is easier for tools to discover and modify accidentally.
- **A custom object database:** rejected for v1 because it recreates hashing, commit graph, tags, transport, integrity checks, and maintenance that Git already provides.

### 2. Encode one component as one canonical ref

Canonical component IDs come from the existing workspace model. Bit Lite encodes the UTF-8 ID using unpadded base64url, which is reversible and collision-free without depending on the component ID's punctuation. The ref layouts are:

```text
refs/heads/components/<base64url-component-id>
refs/tags/components/<base64url-component-id>/<semver>
refs/bit-lite/remotes/origin/components/<base64url-component-id>
refs/bit-lite/remotes/origin/tags/<base64url-component-id>/<semver>
```

Every component commit has zero or one parent. Its parent is always the previous value of that component's canonical head. There is no workspace-wide commit and no cross-component parent relationship. This makes `git log refs/heads/components/<key>` match the user's mental model of one history per component.

The encoding and ref builders live in one module and validate all decoded IDs and versions before use. Raw user input is never concatenated into a ref name.

### 3. Let the commit ID identify history and the tree ID identify content

A snap ID is the component commit object ID. The commit records both the captured component tree and its position in that component's history. Two independent snaps with identical files can therefore have different commit IDs when their parents or commit metadata differ, while their tree IDs remain equal.

Before creating a commit, Bit Lite compares the new tree ID with the current component commit's tree ID. Equal trees are reported as unchanged and do not produce a commit. The commit message is deterministic in shape (`snap <canonical-component-id>`), while normal Git author/committer identity and timestamp supply audit metadata.

Externally reported IDs are algorithm-qualified, such as `sha1:<hex>` or `sha256:<hex>`. The adapter queries the store's object format instead of assuming SHA-1.

Using the tree ID as the snap ID was considered but rejected because it cannot express ancestry or distinguish the same content appearing at different history positions. Adding a Bit Lite manifest to the tree was also rejected for v1 because the agreed snapshot is an exact view of component-owned files.

### 4. Build trees directly from the component directory without a worktree

The history layer receives canonical component descriptors from `bit-lite-context`. It enumerates the component root using `lstat`, stable byte-order path sorting, and an explicit directory-pruning policy. It captures every regular file except contents beneath:

```text
.git
.bit
.bit-lite
.bit-lite-store.git
node_modules
dist
build
coverage
```

Those names are pruned at any depth. Files are written as Git blobs without clean/smudge filters, relative paths are preserved, and tree modes distinguish regular and executable files. Empty directories disappear according to normal Git semantics.

V1 rejects a symbolic link anywhere in the traversed component tree. It does not follow it, even when the target remains inside the component. This keeps traversal confinement and cross-platform reconstruction semantics unambiguous. The error identifies both the component and component-relative path.

The Git adapter uses plumbing commands with argument arrays rather than a shell. It supplies `--git-dir` explicitly and uses a temporary index or batched object operations to construct the tree. The temporary index is not durable state and is removed after the operation. Per-file Git subprocesses should be avoided where batching can preserve clear error handling.

### 5. Separate object preparation from atomic ref publication

`bit-lite snap [--filter <component-pattern> ...]` follows two phases:

1. Resolve the complete component selection, validate roots, enumerate files, write blobs and trees, determine unchanged components, and create commit objects for all changed components.
2. Publish all changed component heads in one `git update-ref --stdin` transaction, with the previously read head (or zero object ID) as the expected old value.

If validation or object preparation fails for any selected component, phase two never starts. If a ref moved concurrently, the ref transaction fails as a whole. Prepared objects may be unreachable after failure; Git garbage collection can remove them later. This is preferable to inventing a second transaction log.

The command reports changed and unchanged components only after the ref transaction result is known. An invocation without filters selects all registered components; an invocation with filters uses the workspace's established matching behavior.

### 6. Represent versions as immutable annotated tags

`bit-lite tag --filter <component-pattern> --version <semver>` resolves exactly one registered component, validates a strict semantic version, and requires an existing current snap. It creates an annotated tag at the component-scoped tag ref and targets the current component commit. It never creates an implicit snap.

Annotated tags are used because they are first-class Git objects with tagger, timestamp, message, and an explicitly typed target. Repeating a tag whose peeled target is already the same snap is idempotent and preserves the existing tag object. Reusing the same component/version for another snap is an error. V1 exposes no force, move, or delete path.

Tag validation also confirms that the peeled commit is reachable from the matching component head. This catches malformed manual changes and prevents cross-component tag assignment.

### 7. Synchronize by fetch, validate, reconcile, transact, then push

`bit-lite sync [--remote <url>]` uses `origin` configured inside the bare store. The first explicit URL configures it. A later different URL is rejected to avoid silently sending component history to another destination; changing it deliberately can be designed as a separate operation later.

Synchronization proceeds as follows:

1. Fetch remote component heads and tags through explicit refspecs into private tracking refs under `refs/bit-lite/remotes/origin/`.
2. Enumerate and validate the complete fetched/local ref set, including names, object types, one-parent component history shape, tag target reachability, and component ownership.
3. For every component head, classify it as equal, local-only, remote-only, local-ahead, remote-ahead, or divergent using commit ancestry.
4. For every component tag, classify it by immutable name and peeled commit target.
5. If any divergence, tag conflict, or malformed ref exists, report all discovered conflicts and stop before canonical local updates or push.
6. Apply all remote-ahead and remote-only canonical local updates in one expected-old-value ref transaction.
7. Publish all local-ahead, local-only, and local-only-tag refs with non-forced explicit refspecs. If more than one ref changes, require `git push --atomic`; do not fall back to separate pushes.

Fetching into private tracking refs is deliberate: directly fetching into canonical heads or tags could overwrite local state before Bit Lite has performed component-specific validation. Tracking refs may advance even if later reconciliation fails; they represent the last fetched observation, not accepted component state.

V1 treats a concurrent remote change as a normal non-fast-forward push failure. The user reruns sync, causing a new fetch and reconciliation. Different component histories remain logically independent, but one sync invocation publishes its selected ref set atomically so users do not observe half of a requested multi-component transfer.

### 8. Isolate Git and history logic from the CLI

Implementation will introduce a focused `bit-lite-history` workspace package, matching the repository's existing package boundaries, with interfaces shaped around domain operations rather than raw commands:

```text
ComponentHistoryStore
  initialize/open
  snap(components)
  tag(component, version)
  sync(remote?)

GitRepositoryAdapter
  object format and object writes
  commit/tree/tag inspection
  ancestry and reachability checks
  transactional local ref updates
  fetch and atomic push
```

The CLI layer owns argument parsing, workspace discovery, component filters, and human-readable output. The history layer owns path safety, store/ref invariants, Git invocation, and structured results. Production code uses the real Git adapter; unit tests can fake the narrow adapter where useful, while integration tests exercise actual bare repositories and local file-protocol remotes.

No command should construct a shell command string. Environment overrides are limited to operation-specific values such as a temporary index path. Git stdout/stderr is bounded and converted to actionable Bit Lite errors without leaking unrelated process environment.

## Risks / Trade-offs

- **[Git becomes a dependency of snap, tag, and sync]** → Detect Git at command entry, report the required capability clearly, and keep all existing commands independent of the store.
- **[The hidden store duplicates component file content already present in the source repository]** → Rely on Git object deduplication and compression within the component store; use a bare repository and avoid checked-out duplicates.
- **[A monorepo with many files may make first snap expensive]** → Prune generated directories before descent, stream or batch hashing, avoid one subprocess per file, and add scale-oriented benchmarks before optimizing the storage model.
- **[Capturing all files can include accidental secrets]** → Document that snaps include dotfiles and all non-excluded component files, show the selected components in command output, and leave richer ignore policy to a later explicit design rather than silently inheriting source `.gitignore` rules.
- **[Fixed exclusions may omit intentionally versioned directories named `build` or `dist`]** → Keep the initial list minimal and documented; add an explicit component snapshot policy in a future compatible change if real use cases require overrides.
- **[Rejecting symlinks limits some component layouts]** → Prefer safe failure in v1; design portable link semantics and confinement checks before allowing them.
- **[Users or tools may manually modify the hidden repository]** → Validate ref layout, object types, ancestry shape, and tag reachability at operation boundaries, and fail without repairing or overwriting unexpected state automatically.
- **[Git commit IDs include author, timestamp, and parent, so the same files do not guarantee the same snap ID across independent histories]** → Treat commit ID as historical identity and tree ID as content identity; expose this distinction in diagnostics and APIs.
- **[Remote servers may not support atomic push]** → Refuse multi-ref non-atomic fallback in v1 and report the server limitation; single-ref sync remains possible.
- **[Fetch can leave updated tracking refs after a conflict]** → Define tracking refs as observations rather than accepted state; canonical refs remain the authority and change only transactionally.
- **[The store grows indefinitely]** → Leave unreachable preparation objects to standard Git garbage collection and defer retention/maintenance policy until actual usage data is available.

## Migration Plan

1. Add `.bit-lite-store.git/` to workspace/demo ignore conventions without changing the existing `.bit-lite/` cache location.
2. Update cleanup scripts that use broad hidden-state patterns so they remove only disposable `.bit-lite` data and never the durable store.
3. Ship the history module and `snap` command behind the new command surface. Existing workspaces require no data migration; the first snap lazily creates the store.
4. Add `tag` after snap invariants and reachability validation are in place.
5. Add `sync` after local storage tests pass, using local bare repositories as deterministic integration remotes.
6. Document backup semantics: before a remote is configured, `.bit-lite-store.git` is the only copy of local component history; after sync, Git refs and objects are replicated to the configured remote.

Rollback is additive: stop invoking the new commands and remove the CLI registration. Existing workspace source and `.bit-lite` state are unaffected. The hidden repository should not be deleted automatically during rollback because it contains durable user history; users can archive or remove it explicitly after confirming a remote or backup exists.

## Open Questions

None block v1. Configurable snapshot exclusions, explicit remote replacement, history repair, checkout/import/export, and dependency/environment metadata are intentionally deferred to separate changes after the basic history model is exercised.

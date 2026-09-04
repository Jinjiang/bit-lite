## Context

`snap`, `tag`, and `sync` produce a store that nothing can read. The store's shape is favorable — each component is a linear history under `refs/heads/components/<component-key>`, versions are annotated tags under `refs/tags/components/<component-key>/<version>`, and snap identity is the commit ID — so inspection is mostly a matter of asking Git the right questions and presenting the answers in component terms.

Three facts from `dependency-aware-versioning` constrain the design:

- The committed `.comp.json` is a projection of workspace state, not the working file. Any comparison between working state and history must project first, or it will report a difference on every component, every time.
- A component gets a new version when a dependency or env version moves, even with untouched source. That was accepted on the explicit condition that inspection can attribute the change.
- Recording resolves a *modified* dependency's version to the snap it is about to create. That version is unavailable to a read-only command in two independent ways: producing it writes a commit object, and a commit ID folds in the author timestamp, so it is not even reproducible. Inspection therefore cannot ask "what version would this dependency get" — it can only ask what version the dependency already carries, and reason about the rest.

`snapComponents`' preparation already computes exactly what `status` and `diff` need: a candidate tree ID for the working component, compared against the head commit's tree ID. The obstacle is that it gets there through `hash-object -w`, which writes objects. A read-only command must not grow the store every time it runs.

## Goals / Non-Goals

**Goals:**

- Answer "what is this component's state right now" without knowing the store's ref encoding.
- Make every recorded version explainable: which files changed, which dependency or env versions moved, or both.
- Make `diff` and `snap` agree by construction, so an empty diff means the next snap reports the component unchanged.
- Surface the disagreement between a component's version anchor and its canonical head, which `sync` can create silently.
- Leave the store byte-identical after any inspection command.
- Reuse the projection rather than defining a second notion of "the component's recorded form".

**Non-Goals:**

- Changing anything a recording command does. This change reads only.
- Refusing to snap when the working tree is behind the head. `status` reports it; whether `snap` should also refuse is left open.
- Reproducing a component at a version: no checkout, restore, or import.
- A cross-component or workspace-wide history view. Every component's history stays independent, as the store's model requires.
- Configurable output formats beyond a machine-readable variant of the same facts.
- Diffing arbitrary Git revisions. Inspection accepts component versions and working state, not raw object IDs.

## Decisions

### 1. Three commands, one shared comparison core

`status`, `log`, and `diff` answer different questions but share one primitive: comparing two component states, where a state is either the working directory or a recorded version.

```text
                     project + walk           compare trees
working directory ──────────────────▶ tree ──┐
recorded version  ── resolve ref ───▶ tree ──┴─▶ file changes + metadata changes
```

`status` compares working state against the head and summarizes many components in one line each. `diff` compares any two states and reports detail for one or a few. `log` walks history and, for each commit, compares it against its parent to attribute the change. Building all three on one comparison keeps them from drifting apart, and it is what makes the `diff`/`snap` agreement in decision 4 structural rather than a coincidence.

Alternatives considered: implementing `status` as its own fast path over ref existence and skipping tree comparison. Rejected because "has uncommitted changes" cannot be answered without the tree comparison, and a second implementation would be the natural place for the two commands to disagree.

### 2. Compute candidate trees without writing objects

Read-only commands must not add unreachable objects to the store. The existing path writes blobs with `hash-object -w` and then hands a flat list of `mode blob path` entries to a temporary index, letting `write-tree` assemble the nested subtrees — which writes every one of them into the store.

Blobs are the easy half: the same batched hashing without `-w` produces the same IDs and persists nothing. Trees are not. Git offers no read-only equivalent of `write-tree` or `mktree`, and the flat entry list the writing path builds is not the tree: the nesting and the entry ordering are Git's work, and Git's ordering is not the snapshot's, because it sorts a directory entry as though it ended in `/`. The compute-only path must therefore build the subtree structure itself and hash each tree object's serialized bytes, applying that ordering rule.

So the two paths share the snapshot and the blob IDs, and genuinely diverge at tree assembly. That makes the equality test in task 1.3 load-bearing rather than a formality: it is the only thing tying a hand-written serializer to Git's own, and it must cover nesting, executable modes, and the substituted `.comp.json`.

Alternatives considered: writing objects and relying on Git garbage collection. Rejected because a command a user runs constantly would grow the store steadily, and unreachable objects are exactly the debris that makes a store hard to reason about.

### 3. Attribute every version to a change source

For a commit and its parent, compare the two trees and classify the change:

| Files other than `.comp.json` changed | Dependency or env versions changed | Reported as |
| --- | --- | --- |
| yes | no | `source` |
| no | yes | `deps`, `env`, or both |
| yes | yes | both |
| no | no | cannot occur — an identical tree is never committed |

This is the requirement that makes the accepted "invisible commit" behavior tolerable: a version produced solely by an env upgrade reports `env` and names the old and new env versions, so a user who sees a new version with no source change gets the reason from the tool instead of from the store.

A component's first snap has no parent and is attributed as the initial version rather than as a change.

### 4. `diff` and `snap` agree by construction

The default comparison is the projection of working state against the head commit's tree — the same two trees `snap` compares to decide whether a component is unchanged. Therefore:

> `diff` reports no changes for a component if and only if `snap` would report it unchanged.

This is stated as a requirement rather than left as an implementation consequence, because the failure it prevents is corrosive: a user who sees "no changes" and then watches `snap` create a commit stops trusting both commands. The two must read the same trees, which decision 1 already arranges.

Comparing the same trees is not enough on its own, because of the third constraint in the context: a component's projection names its dependencies' versions, and a modified dependency's next version cannot be computed read-only. Left there, a component whose own files are untouched but whose dependency is modified would diff as unchanged and then snap into a new commit — precisely the failure above. The rule that closes it:

> A component is modified when its own projected content differs from its head **or** when any of its workspace prerequisites is modified, applied transitively over the prerequisite graph.

This is exact rather than conservative. A modified prerequisite necessarily receives a fresh commit, a fresh commit carries no tag, and its version string therefore always changes — so the dependent's projection always changes too. Propagation reproduces `snap`'s answer without predicting any identifier, which is why it preserves the "if and only if" instead of weakening it to "only if". Inspection reports such a component as modified and attributes it to the dependency, naming the prerequisite that caused it rather than a version it cannot name yet.

An explicit comparison between two recorded versions bypasses working state entirely and has no such relationship.

### 5. Present component metadata changes semantically, everything else as files

A raw text diff of the projected `.comp.json` is unreadable and, worse, misleading: it is not a file the user can open, and its shape differs from the working file. Metadata changes are therefore lifted out of the file list and presented as dependency and env version changes:

```text
ui/button   0.0.0-g9f2c3ab -> working

  source
    M  src/button.tsx
    A  src/button.stories.tsx

  dependencies
    ~  @my-scope/lib.math   0.0.0-ga17d5e0 -> 0.0.0-gc4b8e12
    +  clsx                 ^2.1.0

  env
    ~  @my-scope/env.react  0.0.0-g4e81b2c -> 0.0.0-g9d02f7a
```

`.comp.json` never appears in the file list. Every other file is presented as an ordinary added, modified, or deleted path, without content hunks in the default output.

### 6. Status reports five independent conditions

A component can be in several of these at once, and they answer different questions:

| Condition | Meaning |
| --- | --- |
| never recorded | no canonical head ref exists |
| modified | projected working tree differs from the head's tree, or a prerequisite is modified |
| never released | the head exists and nothing is modified, but no semantic version is assigned to that snap |
| behind | the component's version anchor names an ancestor of the head |
| dependency updates | a dependency's current version differs from the version the head records |

"Behind" exists because `sync` fast-forwards canonical heads without touching working files. A component in that state whose working content is then recorded produces a commit whose parent is the synced version but whose content is based on an ancestor, silently reverting what was synced. `status` must make it visible. Whether `snap` should refuse outright is deliberately left open below, because there is currently no `checkout` to recover with.

"Never released" exists because `tag`'s skip rule treats a component as having nothing new only when its content matches its snap *and* that snap already carries a version. Without this condition a component that `tag` would still act on reports as clean, which makes `status` an unreliable account of what recording would do — the same trust failure decision 4 guards against, one command over.

"Dependency updates" is read from history rather than from the workspace: the working `.comp.json` says `workspace:*`, so the version a component was last recorded against lives only in its head commit's projected metadata.

Two details about versions in this output. A component's anchor and its head can name different versions, and that difference *is* the "behind" condition, so `status` reports both rather than picking one; where they agree there is one version to show. And an anchor is not always spelled the same way: after a `snap` it holds a snap identifier, after a `tag` it holds a semantic version naming a tag ref. Resolving an anchor to a commit must handle both, since the ancestry test is what "behind" means.

### 7. Selection and output follow existing conventions

All three commands take the same `--filter` arguments as other workspace commands and select every registered component when given none. A component with no history is reported rather than skipped, since "never recorded" is one of the most useful things `status` says.

Inspection reads the workspace the way `snap` does: declared workspace state only, never resolved envs or installed packages. That is not incidental. Everything inspection reports is derived from `bit-lite.json`, component roots, and the store, so requiring an install to ask what state a component is in would add a dependency none of the facts have — and it would make `status` unusable in exactly the freshly-cloned workspace where it is most wanted.

Human output is the default. A machine-readable variant carries the same facts, so scripts do not have to parse aligned columns; both come from the same structured result, as existing commands do with their reporters.

### 8. Inspection resolves prerequisite versions without refusing

Recording refuses to resolve a workspace prerequisite left out of the selection when it has never been recorded or has uncommitted changes, because recording would otherwise publish an immutable record naming a combination that was never assembled. That refusal is right for a command that writes.

It is wrong for one that reads. `status --filter ui/button` must still answer when `envs/react` happens to be dirty; a command whose entire job is reporting unrecorded state cannot fail because it found some. Inspection therefore resolves every prerequisite to the version its own head already carries, regardless of the prerequisite's working state, and never refuses.

Nothing is lost by this, because decision 4's propagation carries the same information in reportable form: a prerequisite whose working state differs from its head is itself modified, so the component depending on it is reported modified and told which prerequisite is responsible. What recording expresses by refusing, inspection expresses by reporting — which is the division of labor between the two throughout this change.

## Risks / Trade-offs

- **[Inspection duplicates snapshot logic and drifts from it]** → share the snapshot, the blob hashing, and the projection; the tree serializer is the one part that cannot be shared, so pin it with the equality test in decision 2 rather than assuming the two agree.
- **[Propagated "modified" hides which component actually changed]** → always name the prerequisite responsible, so a component reported modified with untouched files points at the one whose files did change rather than looking like a false positive.
- **[Computing candidate trees is slow for large components]** → inspection hashes the same bytes a snap would, so cost is comparable to a snap without object writes; if it becomes a problem, cache per-file hashes keyed by size and mtime rather than weakening the comparison.
- **[Attribution misreads a metadata-only change]** → derive attribution from the parsed projected metadata rather than from text differences, so formatting or key-order changes cannot be reported as a dependency change.
- **[`status` output grows unreadable in a large workspace]** → report one line per component and keep detail in `diff`; do not attempt a graph view.
- **[Version identifiers are long]** → abbreviate in output as `dependency-aware-versioning` already requires, and never abbreviate in machine-readable output.
- **["Behind" is reported but not actionable]** → there is no `checkout`, so a user can currently only re-apply their work or discard it. Say so plainly in the diagnostic rather than implying a recovery command exists.
- **[Presenting metadata semantically hides a real change]** → any `.comp.json` difference that is not a dependency or env version change must still be reported, so an unexpected metadata change cannot vanish from the output.

## Migration Plan

1. Add the compute-only tree path alongside the existing writing path, with a test asserting both produce the same tree ID.
2. Add history walking and per-component tag lookup to the history layer.
3. Add tree comparison and change-source attribution over parsed projected metadata.
4. Ship `status` first: it exercises projection, compute-only trees, and comparison, and it is the command that makes the other two easy to verify.
5. Ship `log`, which adds only history walking and tag decoration on top.
6. Ship `diff`, which adds explicit state selection and the detailed presentation.

Rollback is removal: these commands read state and write nothing, so unregistering them leaves no residue.

## Open Questions

- **Should `snap` refuse when a component is "behind"?** Carried over from `dependency-aware-versioning`. `status` reporting it is clearly right; refusing to record is a stronger guarantee against silently reverting synced work, but with no `checkout` the user has no clean recovery path. Worth deciding once `status` has made the situation observable in practice.
- Whether `log` should offer a whole-workspace view interleaving components by time. The store's model makes each history independent, so any interleaving is a presentation choice rather than a fact about the data; deferring until there is a concrete use for it.
- Whether `diff` should show file content hunks. The default is a path list; hunks are useful for review but push the command toward reimplementing a pager. Deferred until the path list proves insufficient.

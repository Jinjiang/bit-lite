## Context

`snap`, `tag`, and `sync` produce a store that nothing can read. The store's shape is favorable — each component is a linear history under `refs/heads/components/<component-key>`, versions are annotated tags under `refs/tags/components/<component-key>/<version>`, and snap identity is the commit ID — so inspection is mostly a matter of asking Git the right questions and presenting the answers in component terms.

Three facts from `dependency-aware-versioning` constrain the design:

- The committed `.comp.json` is a projection of workspace state, not the working file. Any comparison between working state and history must project first, or it will report a difference on every component, every time.
- A component gets a new version when a dependency or env version moves, even with untouched source. That was accepted on the explicit condition that inspection can attribute the change.
- Recording resolves a *modified* dependency's version to the snap it is about to create. That version is unavailable to a read-only command in two independent ways: producing it writes a commit object, and a commit ID folds in the author timestamp, so it is not even reproducible. Inspection therefore cannot ask "what version would this dependency get" — it can only ask what version the dependency already carries, and reason about the rest.

`snapComponents`' preparation already computes exactly what `status` needs: a candidate tree ID for the working component, compared against the head commit's tree ID. The obstacle is that it gets there through `hash-object -w`, which writes objects. A read-only command must not grow the store every time it runs.

## Goals / Non-Goals

**Goals:**

- Answer "what is this component's state right now" without knowing the store's ref encoding.
- Make every recorded version explainable: which files changed, which dependency or env versions moved, or both.
- Make `status` and `snap` agree by construction, so a component reported clean is one the next snap will not act on.
- Make `diff` emit a patch rather than a transcript, so its output survives being redirected to a `*.diff` file and read by the tools that already understand one.
- Surface the disagreement between a component's version anchor and its canonical head, which `sync` can create silently.
- Leave the store byte-identical after any inspection command.
- Reuse the projection rather than defining a second notion of "the component's recorded form".

**Non-Goals:**

- Changing anything a recording command does. This change reads only.
- Refusing to snap when the working tree is behind the head. `status` reports it; whether `snap` should also refuse is left open.
- Reproducing a component at a version: no checkout, restore, or import.
- A cross-component or workspace-wide history view. Every component's history stays independent, as the store's model requires.
- Configurable output formats beyond a machine-readable variant of the same facts. No pager, no colorization, no configurable context width, no rename or copy detection, no word-level diff.
- Diffing arbitrary Git revisions. Inspection accepts component versions and working state, not raw object IDs.

## Decisions

### 1. Three commands, one shared comparison core

`status`, `log`, and `diff` answer different questions but share one primitive: comparing two component states, where a state is either the working directory or a recorded version.

```text
                     project + walk           compare trees
working directory ──────────────────▶ tree ──┐
recorded version  ── resolve ref ───▶ tree ──┴─▶ file changes + metadata changes
```

The three commands divide the surface by *what kind of answer* they give, not by which trees they read:

| Command | Question | Form of the answer |
| --- | --- | --- |
| `status` | what state is each component in, and what will recording act on | conditions per component; `--detail` expands **modified** into files and metadata changes |
| `log` | why does each recorded version exist | one entry per snap, attributed against its parent |
| `diff` | what exactly is different in the content | a unified diff |

`status` and `log` *report*: they name changes in the workspace's vocabulary, and `.comp.json` is presented as dependency and env changes rather than as a file. `diff` *reproduces*: it emits the content itself, so `.comp.json` appears as an ordinary file patch like any other. That distinction, not the choice of trees, is what decides where each presentation rule applies.

Building all three on one comparison keeps them from drifting apart, and it is what makes the `status`/`snap` agreement in decision 4 structural rather than a coincidence.

Alternatives considered: implementing `status` as its own fast path over ref existence and skipping tree comparison. Rejected because "has uncommitted changes" cannot be answered without the tree comparison, and a second implementation would be the natural place for the two commands to disagree.

Also considered: keeping the semantic comparison report in `diff` and adding hunks alongside it. Rejected because the two answers have incompatible shapes. A report can carry a conclusion that has no content behind it — "this component will move because `ui/theme` is dirty" — and a patch cannot; a patch, in turn, must stay parseable, which a report's prose breaks. Splitting them puts each answer where its form belongs, and it is what lets `diff` commit fully to being a patch.

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

### 4. `status` and `snap` agree by construction

The comparison behind `status` is the projection of working state against the head commit's tree — the same two trees `snap` compares to decide whether a component is unchanged. Therefore:

> `status` reports a component as modified if and only if `snap` would act on it.

This is stated as a requirement rather than left as an implementation consequence, because the failure it prevents is corrosive: a user who sees "no changes" and then watches `snap` create a commit stops trusting both commands. The two must read the same trees, which decision 1 already arranges.

Comparing the same trees is not enough on its own, because of the third constraint in the context: a component's projection names its dependencies' versions, and a modified dependency's next version cannot be computed read-only. Left there, a component whose own files are untouched but whose dependency is modified would diff as unchanged and then snap into a new commit — precisely the failure above. The rule that closes it:

> A component is modified when its own projected content differs from its head **or** when any of its workspace prerequisites is modified, applied transitively over the prerequisite graph.

This is exact rather than conservative. A modified prerequisite necessarily receives a fresh commit, a fresh commit carries no tag, and its version string therefore always changes — so the dependent's projection always changes too. Propagation reproduces `snap`'s answer without predicting any identifier, which is why it preserves the "if and only if" instead of weakening it to "only if". Inspection reports such a component as modified and attributes it to the dependency, naming the prerequisite that caused it rather than a version it cannot name yet.

An explicit comparison between two recorded versions bypasses working state entirely and has no such relationship.

This guarantee belongs to `status` and not to `diff`, and that is a consequence of the propagation rule rather than a preference. A component modified only because its prerequisite is dirty has *no content difference of its own*: inspection resolves that prerequisite to the version at its own head, which is the version the component already recorded, so both sides of the comparison are byte-identical — including the projected `.comp.json`. There is nothing for a patch to show. `diff` therefore emits an empty patch for a component `status` calls modified, and the only honest thing to do is say so plainly. It goes to standard error, because standard output has to stay a valid patch.

### 5. Reports present metadata semantically; patches present it as a file

A *report* that rendered the projected `.comp.json` as text would be misleading: it is not a file the user can open, its keys are sorted, and its `workspace:*` specifiers have been substituted, so reformatting would read as a version change. In `status --detail` and in `log`, metadata is therefore lifted out of the file list and presented as dependency and env version changes:

```text
ui/theme   0.0.0-g9f2c3ab   modified
  M  src/palette.ts
  A  src/tokens.css
  dependency  @my-scope/lib.math   0.0.0-ga17d5e0 -> 0.0.0-gc4b8e12
  env         @my-scope/env.react  0.0.0-g4e81b2c -> 0.0.0-g9d02f7a
```

A *patch* is the opposite case. `.comp.json` is a real file in the tree, the snap records it, and a patch claiming to be the difference between two states cannot silently omit one of the files that differ. So `diff` includes it as an ordinary file patch — and it turns out to be the most informative hunk in the output, because it shows the dependency version substitution that produced the new version, in the exact form the store holds it.

The two rules do not conflict; they follow from the same premise. What makes text misleading in a report — that the file is a projection, not something the user wrote — is precisely what makes it *worth showing* in a patch, where the subject is the recorded bytes rather than the user's edit.

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

Two commands narrow that further, and for the same reason in both cases: a version identifier is local to one component's history, so there is no sensible reading of it across a selection. `log` lists one component's history; `diff` requires a single component *only when two recorded versions are named*. A default `diff` names no version and therefore stays multi-component, which is what makes `bit-lite diff > changes.diff` a useful thing to type — and what the component-qualified paths in decision 9 exist to support.

Inspection reads the workspace the way `snap` does: declared workspace state only, never resolved envs or installed packages. That is not incidental. Everything inspection reports is derived from `bit-lite.json`, component roots, and the store, so requiring an install to ask what state a component is in would add a dependency none of the facts have — and it would make `status` unusable in exactly the freshly-cloned workspace where it is most wanted.

Human output is the default. A machine-readable variant carries the same facts, so scripts do not have to parse aligned columns; both come from the same structured result, as existing commands do with their reporters.

### 8. Inspection resolves prerequisite versions without refusing

Recording refuses to resolve a workspace prerequisite left out of the selection when it has never been recorded or has uncommitted changes, because recording would otherwise publish an immutable record naming a combination that was never assembled. That refusal is right for a command that writes.

It is wrong for one that reads. `status --filter ui/button` must still answer when `envs/react` happens to be dirty; a command whose entire job is reporting unrecorded state cannot fail because it found some. Inspection therefore resolves every prerequisite to the version its own head already carries, regardless of the prerequisite's working state, and never refuses.

Nothing is lost by this, because decision 4's propagation carries the same information in reportable form: a prerequisite whose working state differs from its head is itself modified, so the component depending on it is reported modified and told which prerequisite is responsible. What recording expresses by refusing, inspection expresses by reporting — which is the division of labor between the two throughout this change.

### 9. The patch is the output contract

`diff` exists to be redirected. A user writes `bit-lite diff > changes.diff`, opens it in an editor, and expects the same highlighting a Git patch gets. That fixes several things that are otherwise matters of taste.

**Standard output carries the patch and nothing else.** Any advisory — the empty-patch case from decision 4 above all — goes to standard error. No colorization either: `bit diff` colors by default, which means a redirected Bit diff has ANSI escapes embedded in the file.

**Paths are `a/<component-id>::<path>`.** Two constraints pull against each other here. Paths must be self-sufficient, because a `diff --git` line is the only thing an editor's patch view has to identify a file, and two components can each own a `src/index.ts`; without qualification they collide on one path and a patch viewer merges them. But a component identifier already contains a slash, so `a/ui/button/src/index.ts` leaves no visible boundary. `::` supplies one, appears in neither a component identifier nor a POSIX path, and stays inside the path token where no parser looks.

We do not claim these paths apply to a checkout. Making them applicable would mean addressing files at their workspace-relative location, which reintroduces nothing useful — a patch produced against a computed tree is not a patch anyone should apply blind — and gives up the component qualification.

**A banner separates components.** Adapted from `bit diff`, which frames each component with a rule and a `showing diff for <id>` line. One correction: Bit's rule is a row of hyphens, and a line beginning `---` collides with the old-file marker, so a line-based highlighter reads it as a file header or a deleted line. Bit gets away with it because it discards the `diff --git` and `index` lines and its output is not a patch. Ours is, so every banner line begins with a character unified diff gives no meaning to.

The banner carries the version transition for the whole component, stated once:

```text
# ui/button  0.0.0-ga17d5e0 -> working
# ============================================================
```

`bit diff` instead appends the state to every `---` and `+++` line, as `--- src/button.tsx (0.0.1)`. That is the right answer when there is no banner to put it in, and Bit does not have one; with a banner the per-file repetition is noise. Each fact then appears exactly once: the banner says which component and between which states, the `diff --git` line says which file, and the file headers stay Git-standard.

**Blob IDs on the `index` line are real.** Both sides have genuine object IDs — the working side's blobs are hashed by Git without `-w`, so the ID is correct even though nothing was written. It costs nothing to emit and it is true.

**Line comparison.** Standard three lines of context. Content that is not valid UTF-8 is reported as differing binary rather than rendered, as Git does. A mode-only change is emitted with no hunk, because the executable bit is part of what a snap records and a patch that dropped it would understate the difference.

Alternatives considered: shelling out to `git diff --no-index` on temporary files, which is how Bit does it. Rejected because the working side's tree was deliberately never written, so we would be writing temporary files to recover content we already hold in memory, and because rewriting Git's output with regular expressions to correct the paths — Bit's `regExpA`/`regExpB` — makes the format a function of the local Git version.

## Risks / Trade-offs

- **[Inspection duplicates snapshot logic and drifts from it]** → share the snapshot, the blob hashing, and the projection; the tree serializer is the one part that cannot be shared, so pin it with the equality test in decision 2 rather than assuming the two agree.
- **[Propagated "modified" hides which component actually changed]** → always name the prerequisite responsible, so a component reported modified with untouched files points at the one whose files did change rather than looking like a false positive.
- **[Computing candidate trees is slow for large components]** → inspection hashes the same bytes a snap would, so cost is comparable to a snap without object writes; if it becomes a problem, cache per-file hashes keyed by size and mtime rather than weakening the comparison.
- **[Attribution misreads a metadata-only change]** → derive attribution from the parsed projected metadata rather than from text differences, so formatting or key-order changes cannot be reported as a dependency change.
- **[`status` output grows unreadable in a large workspace]** → report one line per component by default and keep the expansion behind `--detail`; do not attempt a graph view.
- **[Version identifiers are long]** → abbreviate in output as `dependency-aware-versioning` already requires, and never abbreviate in machine-readable output.
- **["Behind" is reported but not actionable]** → there is no `checkout`, so a user can currently only re-apply their work or discard it. Say so plainly in the diagnostic rather than implying a recovery command exists.
- **[Presenting metadata semantically hides a real change]** → any `.comp.json` difference that is not a dependency or env version change must still be reported, so an unexpected metadata change cannot vanish from the output.
- **[An empty patch is read as "nothing will happen"]** → decision 4's propagation case produces exactly that. Say it on standard error naming the prerequisite, and point at `status` as the authority on what recording will act on; never solve it by writing prose into the patch.
- **[A hand-written diff disagrees with the one users know]** → the format is fixed and small: standard context, no rename detection, no heuristics. Where behavior is a choice rather than a rule, follow Git — binary reporting, mode-only changes, `/dev/null` for absent sides — and test the serialized bytes rather than a rendered impression of them.
- **[Patch output is unbounded for large or generated files]** → a patch is the content by definition, so there is no clipping to apply without lying about it. `status --detail` is the bounded view; keep it good enough that `diff` is only reached when the content is actually wanted.

## Migration Plan

1. Add the compute-only tree path alongside the existing writing path, with a test asserting both produce the same tree ID.
2. Add history walking and per-component tag lookup to the history layer.
3. Add tree comparison and change-source attribution over parsed projected metadata.
4. Ship `status` first: it exercises projection, compute-only trees, and comparison, and it is the command that makes the other two easy to verify.
5. Ship `log`, which adds only history walking and tag decoration on top.
6. Ship `status --detail`, which is the semantic comparison presented per component; it reuses the comparison from step 3 and adds no new reading.
7. Ship `diff`, which adds explicit state selection, blob content reading, line comparison, and unified diff serialization.

Rollback is removal: these commands read state and write nothing, so unregistering them leaves no residue.

## Open Questions

- **Should `snap` refuse when a component is "behind"?** Carried over from `dependency-aware-versioning`. `status` reporting it is clearly right; refusing to record is a stronger guarantee against silently reverting synced work, but with no `checkout` the user has no clean recovery path. Worth deciding once `status` has made the situation observable in practice.
- Whether `log` should offer a whole-workspace view interleaving components by time. The store's model makes each history independent, so any interleaving is a presentation choice rather than a fact about the data; deferring until there is a concrete use for it.
- Whether `status --detail` earns its place beside `diff`, or whether the file list it adds is better read from the patch. Kept for now because the two answer different questions — `--detail` explains *why recording will act*, including the prerequisite case a patch cannot show — but the overlap is real and worth revisiting with use.
- Whether `diff` should offer summary modes over the patch, as `bit diff` does with `--name-only` and `--stat`. Deferred: `status --detail` already covers the name-only shape, and adding modes that suppress hunks would put the command back in the business of reporting.

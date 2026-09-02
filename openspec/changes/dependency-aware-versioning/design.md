## Context

`bit-lite snap` records the exact bytes of every component-owned file, including `.comp.json`. Because a workspace-internal dependency is spelled `workspace:*`, the recorded metadata never names a version, and because the env reference lives in `bit-lite.json` outside the component root, it is not recorded at all. A component snap therefore describes its own source but not the workspace it was built against.

Two facts about the existing code shape this design:

- `workspace:*` is currently the load-bearing signal for "this dependency is a workspace component". `readWorkspace`, `install`, and `env-loader` all branch on it. Rewriting it on disk would break six call sites for no benefit, so this design never touches the file's dependency values.
- `snapComponents` already separates object preparation from ref publication, and already compares the candidate tree ID against the head commit's tree ID to detect an unchanged component. Both properties must survive.

The recording commands must also stay independent of install state. `runSnapCommand` deliberately uses `readWorkspace` rather than `resolveWorkspace`, and `history-independence.test.ts` guards that boundary.

## Goals / Non-Goals

**Goals:**

- Record, for every snap, which version of each workspace dependency and which env the component was built against.
- Keep the workspace `.comp.json` stable and authored: `workspace:*` stays, and only a single `version` anchor is ever written back.
- Guarantee that a dependency's version is settled before any dependent is recorded.
- Refuse to record a component/dependency combination that was never actually assembled on disk.
- Preserve the existing all-or-nothing guarantee: a failed operation moves no ref and writes no workspace file.
- Keep `bit-lite-history` unaware of workspaces, envs, and dependency graphs.
- Keep `snap`, `tag`, and `link` independent of install state and of each other's storage.

**Non-Goals:**

- `log`, `diff`, and `status`. They are the companion `component-history-inspection` change, and this change deliberately ships without them.
- Reproducing a component from a snap: checkout, import, export, and fork remain absent.
- Dependency inference. `.comp.json` dependency records stay authored.
- Moving the env reference out of `bit-lite.json`. `.comp.json` is expected to become fully derived state, so authored configuration should not be pushed into it, and the schema change is not worth its blast radius.
- Recording the resolved installed version of an external env package. That would make `snap` depend on a completed install.
- Merging, rebasing, or repairing divergent component histories.

## Decisions

### 1. `workspace:*` stays on disk; resolution happens only in the projection

`workspace:*` is a placeholder that states a fact about the present workspace: this dependency is a sibling component, develop against whatever it is right now. That fact does not expire, so the file should keep saying it. What expires is the *recording* of it, and a recording is exactly what a snap is.

Committed content is therefore a **projection** of workspace state rather than a copy of the working tree. `project()` is a pure function of the component's on-disk `.comp.json`, its `bit-lite.json` entry, and the versions already settled in this operation. It performs three operations on `.comp.json` and nothing else:

```text
resolve   dependencies[<workspace component>] : "workspace:*" -> "0.0.0-g<oid>" or "<semver>"
inject    env : { packageName, version }        from bit-lite.json, workspace:* resolved
strip     version                               the on-disk anchor never enters the tree
```

Every other captured file is still recorded byte for byte.

Alternatives considered:

- **Rewrite `workspace:*` to a concrete version on disk.** Rejected: it destroys the only signal distinguishing a local component from an npm package, and it invents an on-disk concept ("I am pinned to an older sibling") that has no meaning inside a workspace, where you always develop against current siblings.
- **Move the env reference into `.comp.json` so the file can be captured verbatim.** Rejected: `.comp.json` is intended to become generated state, and pushing authored env configuration into it moves in the wrong direction. It is also a breaking `bit-lite.json` schema change.
- **Record the resolved installed version of an external env.** Rejected: it makes `snap` depend on `install` having run and on env packages being resolvable, invalidating the independence boundary. The declared specifier from `bit-lite.json` is recorded instead. For a local env the two coincide, because a local env's version *is* its snap version.

### 2. The `version` anchor must be excluded from the tree

`.comp.json` gains a `version` field recording which version the working component is based on. It cannot be part of the committed tree, and this is derived rather than chosen:

```text
if version entered the tree:
  snap creates commit H, then writes version = 0.0.0-gH back to disk
  the next snap captures a .comp.json that differs from the previous one
  the tree differs, so a commit is created even though nothing changed
  => unchanged detection is permanently broken
```

Recording the *parent* version instead fails the same way. Keeping the anchor outside the tree is the only option that preserves content-aware snapping, and it is also what lets tagging a leaf component avoid creating a redundant snap (decision 6).

The anchor is not decorative. It is the only place that records what the working tree is based on, which matters because `sync` can fast-forward a component's canonical head (`SyncOutcome` includes `imported` and `fast-forwarded`) without touching working files.

### 3. Snap versions are `0.0.0-g<full object id>` and are identifiers, not ordered versions

```text
0.0.0-g9f2c3ab4d5e6f7081a2b3c4d5e6f708192a3b4c5
```

The `g` prefix follows `git describe` (`v1.2.3-4-g9f2c3ab`) and guarantees the prerelease identifier always contains a letter. Without it, an all-digit hex string with a leading zero is an invalid semantic version, which `assertComponentVersion`'s strict parse would reject. The probability is negligible at full length but reaches roughly 1 in 2,800 at twelve hex characters, so the prefix removes a class of failure rather than an unlikely one.

The full object ID is used rather than a truncation so the version resolves itself: `git rev-parse` locates the commit directly, with no ambiguity that grows as the store grows, and no risk of a permanently written identifier becoming ambiguous later. Human-facing output truncates to a short form the way Git does; files store the full value.

**Snap versions carry no ordering.** Semantic-version precedence compares prerelease identifiers lexically, so `0.0.0-ga…` sorts above `0.0.0-g9…` with no relationship to history. Any logic that sorts these, takes a maximum, or computes a "latest" produces an arbitrary answer. Ancestry queries against the store are the only correct way to order snaps.

The shape `^0\.0\.0-g[0-9a-f]+$` is reserved: `tag` refuses it, so a user-assigned version can never collide with a generated identifier.

Alternatives considered: a plain `0.0.0-<hash>` as Bit spells it, which is more familiar but leaves the invalid-version edge case to be special-cased; and a truncated hash, which is far more readable but makes ambiguity and the invalid-version case reachable.

### 4. Recording runs in dependency order over one shared prerequisite definition

A component's prerequisites are its workspace dependency edges (`workspace:*` entries in `.comp.json`) **and** its env edge (a `workspace:*` env in `bit-lite.json`). An env is a component whose version must be settled before its users are recorded.

The repository currently holds two orderings: `orderWorkspaceComponents` in `bit-lite-context`, which omits env edges and has no production caller, and `compilePrerequisitePackageNames` in `compile.ts`, which is correct but private. This change promotes the correct definition into `bit-lite-context` as the single shared ordering used by compile, snap, and tag, and removes or corrects the misleading export rather than leaving two answers in the tree.

### 5. Unresolvable dependencies fail the operation

While materializing a component, every `workspace:*` dependency must produce a version. Three cases:

| Dependency state | Behavior |
| --- | --- |
| Never snapped | Fail. There is no version to record. |
| Has a head, working content differs from it ("dirty") | Fail. |
| Has a head, working content matches it | Record that head's version. |

"Dirty" here means the candidate tree ID computed by the ordinary snapshot rules differs from the head commit's tree ID. It is unrelated to the source repository's `git status`; it is the inverse of the `unchanged` test `prepareComponent` already performs.

The second case fails rather than recording the dependency's head version because doing so produces a snapshot asserting a combination that was never assembled: the dependent was compiled and tested against the dependency's *uncommitted* working code, while the record would name the dependency's previous version. Component versions are immutable, so such a record cannot be withdrawn later. The diagnostic names the offending dependency and suggests including it in the selection.

Alternatives considered: automatically extending the selection to include modified dependencies, which is Bit's behavior but silently makes `--filter` mean "at least these" and can cascade through a chain the user did not ask about; and recording the stale version with a warning, which leaves the unverifiable combination in immutable history behind a message that is easy to miss.

### 6. Tagging is generalized, not redefined

The current rule is that `tag` never creates a snap. The new rule is a superset:

> `tag` = project, create a snap if the projection changed the component's content, then annotate.

For a component with no workspace dependencies, the projection changes only fields that are already excluded from or absent in the tree, so the tree is unchanged and the tag names the existing snap — exactly today's behavior. For a component whose dependencies move from snap identifiers to semantic versions, the projection genuinely changes the tree, so a commit must exist to carry that content before it can be annotated. Ordering (decision 4) is what makes the dependency's semantic version available in time.

### 7. Materialize in memory, publish refs, then write back

```text
for each layer in dependency order:
  for each component in the layer:
    bytes = project(workspace .comp.json, bit-lite.json, resolved)
    assert every workspace dependency resolved (decision 5)
    prepared = prepareComponentSnap(store, component, { ".comp.json": bytes })
    resolved[packageName] = "0.0.0-g" + prepared.commitId

publishSnaps(store, prepared)          # one ref transaction, unchanged
writeBack(version anchors)             # only after publication succeeds
```

Committed bytes never equal disk bytes, so the history layer needs a way to substitute one captured file's content regardless. Given that entry point, materializing in memory costs nothing extra and preserves the existing guarantee that a failure leaves every ref and every workspace file untouched. Writing each component's file before capturing it would leave a half-rewritten workspace behind a mid-operation failure.

Dependency versions are resolved from the versions settled earlier in this same run, falling back to the store's canonical head refs. They are **not** read from the dependency's on-disk `version` anchor, which is a mirror that goes stale after a `sync` fast-forward.

### 8. The history layer stays workspace-agnostic

`bit-lite-history` continues to accept `{ componentId, rootDir }` and knows nothing about envs, package names, or dependency graphs. It exposes the two phases already implicit in `snapComponents` — prepare and publish — plus per-file content substitution. The command layer owns the workspace, the graph, the topological loop, the strictness checks, and the pure `project()` function. This keeps the projection trivially unit-testable and leaves the storage boundary where the existing design put it.

### 9. Generated package manifests carry versions, read from disk

`createGeneratedPackageManifest` writes a real version for a local dependency instead of `workspace:*`, and sets the manifest's own `version` from the component's anchor rather than the current hard-coded `"0.0.0"`. A component that has never been snapped contributes `0.0.0`.

Both values come from `.comp.json` on disk, so `link` still never opens the history store. The manifest describes what is actually linked right now, which is the dependency's current version rather than anything recorded in history. After a `sync` fast-forward the on-disk anchors are briefly stale and so are these manifests; nothing consumes these versions today because resolution happens through symlinks.

## Risks / Trade-offs

- **[A component gets a new version with no visible change on disk]** — an env or dependency version moving produces a new snap for every dependent even when their source is untouched. This is correct and matches Bit, but until the companion inspection change lands, the only way to see why is to read the committed `.comp.json` out of the store. Mitigation: ship `component-history-inspection` next, and require it to attribute each snap to `source`, `deps`, or `env`.
- **[Recording cascades through the graph]** — one change to a low-level component produces new versions for everything above it. Mitigation: report changed and unchanged components as today, and make the change source visible in the inspection change.
- **[`snap` becomes a command that writes to the workspace]** — it now rewrites the `version` anchor. Mitigation: write back only after the ref transaction succeeds, and write only that one field. No vendor, compiler, or watch path reads `.comp.json`, so no running task is disturbed.
- **[The version anchor can disagree with the canonical head]** — `sync` can fast-forward a head while working files stay behind, after which snapping would record working content on top of a parent it was never based on, silently reverting the synced change. This change makes the disagreement *detectable* but does not yet act on it. See Open Questions.
- **[Snap versions look orderable but are not]** — `0.0.0-g…` parses as a valid semantic version, so a naive sort or "latest" computation will silently produce a wrong answer. Mitigation: state it in the spec, and never expose an ordering helper over these values.
- **[The version string drops the object-format qualifier]** — existing diagnostics report IDs as `sha1:<hex>` or `sha256:<hex>`, while `0.0.0-g<hex>` carries only the hex. A store has exactly one object format and `sync` requires matching formats, so the value is unambiguous where it is used. Mitigation: keep algorithm-qualified spellings in human-facing diagnostics.
- **[Committed `.comp.json` no longer matches the working file]** — any future comparison of a component against its history must compare projections rather than raw bytes. Mitigation: make `project()` the single shared entry point so the inspection change cannot accidentally compare the wrong forms.
- **[Strict `--filter` makes single-component snapping less convenient]** — a user wanting to record one component may be forced to name its dependencies too. Mitigation: the error names the missing or modified dependency and shows the corrected command.

## Migration Plan

1. Add the shared prerequisite/ordering definition to `bit-lite-context`, move `compile.ts` onto it, and correct or remove `orderWorkspaceComponents`. No behavior changes.
2. Teach `bit-lite-context` to read an optional `version` field from `.comp.json`. Absent means "never snapped"; existing workspaces stay valid.
3. Add per-file content substitution to the history layer's snapshot and object creation, and expose the prepare/publish phases. Existing `snapComponents` behavior is preserved as a caller of them.
4. Add `project()` and the version formatter with unit tests, before wiring them into any command.
5. Move `snap` onto the topological loop with strictness checks and write-back.
6. Move `tag` onto projection-then-snap-if-changed, and reserve the `0.0.0-g` namespace in `assertComponentVersion`.
7. Update `link`'s generated manifests.
8. Update the demo workspace: existing components acquire a `version` anchor on their next snap. Existing stores need no migration — previously recorded snaps remain valid, they simply carry an unprojected `.comp.json`.

Rollback is additive at the command level: reverting the command-layer changes restores byte-for-byte capture. Snaps recorded under the projection remain readable; they are ordinary commits whose `.comp.json` happens to name resolved versions.

## Open Questions

- **Should `snap` refuse when a component's `version` anchor disagrees with its canonical head?** The `sync` fast-forward hazard above is real today, and the anchor introduced here is exactly what makes it detectable. Adding the guard is cheap, but it is a behavior this change did not set out to add, and the recovery path for a user who hits it (there is no `checkout`) is unclear. Deciding this may be better placed with `component-history-inspection`, where `status` will need to report the same disagreement.
- Whether components recorded before this change should be re-snapped so their history carries resolved dependency versions throughout, or whether a mixed history is acceptable. A mixed history is expected to be fine, since nothing yet reads recorded dependency versions back.

## Context

`bit-lite snap` records the exact bytes of every component-owned file, including `.comp.json`. Because a workspace-internal dependency is spelled `workspace:*`, the recorded metadata never names a version, and because the env reference lives in `bit-lite.json` outside the component root, it is not recorded at all. A component snap therefore describes its own source but not the workspace it was built against.

Two facts about the existing code shape this design:

- `workspace:*` is currently the load-bearing signal for "this dependency is a workspace component". `readWorkspace`, `install`, and `env-loader` all branch on it. Rewriting it on disk would break six call sites for no benefit, so this design never touches the file's dependency values.
- `snapComponents` already separates object preparation from ref publication, and already compares the candidate tree ID against the head commit's tree ID to detect an unchanged component. Both properties must survive.

The recording commands must also stay independent of install state. `runSnapCommand` deliberately uses `readWorkspace` rather than `resolveWorkspace`, and `history-independence.test.ts` guards that boundary.

## Goals / Non-Goals

**Goals:**

- Record, for every snap, which version of each workspace dependency and which env the component was built against.
- Keep the working `.comp.json` stable and authored: `workspace:*` stays, and no recording command writes to it at all.
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

Committed content is therefore a **projection** of workspace state rather than a copy of the working tree. `project()` is a pure function of the component's on-disk `.comp.json`, its `bit-lite.json` entry, and the versions already settled in this operation. It performs two operations on `.comp.json` and nothing else:

```text
resolve   dependencies[<workspace component>] : "workspace:*" -> "0.0.0-g<oid>" or "<semver>"
inject    env : { packageName, version }        from bit-lite.json, workspace:* resolved
```

Every other captured file is still recorded byte for byte, and the working `.comp.json` itself is never modified.

Alternatives considered:

- **Rewrite `workspace:*` to a concrete version on disk.** Rejected: it destroys the only signal distinguishing a local component from an npm package, and it invents an on-disk concept ("I am pinned to an older sibling") that has no meaning inside a workspace, where you always develop against current siblings.
- **Move the env reference into `.comp.json` so the file can be captured verbatim.** Rejected: `.comp.json` is intended to become generated state, and pushing authored env configuration into it moves in the wrong direction. It is also a breaking `bit-lite.json` schema change.
- **Record the resolved installed version of an external env.** Rejected: it makes `snap` depend on `install` having run and on env packages being resolvable, invalidating the independence boundary. The declared specifier from `bit-lite.json` is recorded instead. For a local env the two coincide, because a local env's version *is* its snap version.

### 2. The `version` anchor lives in workspace configuration, beside the env reference

Each `bit-lite.json` component entry gains an optional `version` recording which version the working component is based on. It sits next to that entry's `env` reference because the two are the same kind of fact: both describe the component rather than declaring its dependencies, and both are rewritten by a recording command rather than authored. Splitting them across two files would make one of them the odd one out for no reason.

`bit-lite.json` follows Bit's `.bitmap`, which is exactly where Bit records the version each component is currently at. It is generated state presented readably, not a file whose every line is hand-maintained, so machine-written values belong in it.

Placing the anchor here also means it lies outside every component root and is therefore never captured by any snap. The self-reference problem simply cannot arise, and the projection needs no removal step.

Alternatives considered:

- **A `version` field in the component's own `.comp.json`.** Rejected. It would have to be excluded from the committed tree, and that exclusion is forced rather than chosen: if the anchor entered the tree, snapping would create commit `H`, write `version = 0.0.0-gH` back, and make the next snap capture a different `.comp.json` — producing a commit even though nothing changed, and permanently breaking unchanged detection. Recording the *parent* version instead fails the same way. Keeping the field but hiding it from the tree works, but it buys a subtle rule for no benefit once `env` injection has already made the committed file differ from the working one.
- **A ref inside the store, such as `refs/bit-lite/base/<component-key>`.** Rejected: it would make recording fully read-only against the workspace, but the anchor becomes invisible to anyone reading the workspace, which is the opposite of what it is for.
- **A file under `.bit-lite`.** Rejected: that directory is disposable cache, so cleaning it would make every component look as if it had never been recorded.

The anchor is not decorative. It is the only place recording what the working tree is based on, which matters because `sync` can fast-forward a component's canonical head (`SyncOutcome` includes `imported` and `fast-forwarded`) without touching working files.

One registration hole must be closed alongside this. A component entry may currently declare `path: "."`, which passes the inside-the-workspace check and makes the component root the workspace root — putting `bit-lite.json` inside a captured tree and recreating exactly the self-reference this placement avoids. Registering a component at the workspace root is rejected.

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

For a component with no workspace dependencies and no local env, the projection produces the same content it produced for the current snap, so the tree is unchanged and the tag names the existing snap — exactly today's behavior. For a component whose dependencies move from snap identifiers to semantic versions, the projection genuinely changes the tree, so a commit must exist to carry that content before it can be annotated.

### 7. Tagging is a multi-component operation that derives a version per component

`tag` previously required a selection resolving to exactly one component and a single `--version`. That shape encodes an assumption that does not hold: a release usually covers several components, and they do not share a version number.

`tag` therefore selects components the way every other workspace command does — no filter means every registered component — and processes the selection in the same dependency order recording uses. Each component's version is derived independently:

```text
highest existing version tag on the component  ->  patch incremented
no existing version tag                        ->  0.0.1
```

Deriving per component is what makes decision 6 work inside a single invocation. Tagging `lib/math` and `ui/button` together settles `lib/math`'s semantic version before `ui/button` is projected, so `ui/button`'s recorded metadata names `lib/math@0.2.1` rather than a snap identifier. Without multi-component tagging, a dependent tagged in a later invocation would have to guess whether its dependency's "current version" meant that dependency's tag or its snap identifier — an ambiguity that disappears entirely once ordering happens within one operation.

The base for the increment comes from the component's existing version tags in the store, not from its version anchor: after a snap the anchor holds a snap identifier, which is not a semantic version and carries no ordering. Existing tags are real semantic versions, so taking the maximum is meaningful.

`--version` survives as an override for the single-component case, and is refused when the selection resolves to more than one component, because one explicit number cannot describe several components. Choosing minor or major increments, or a per-component version, is a presentation problem over this same derivation; an interactive selection flag can be added later without changing any of it.

Alternatives considered: keeping `tag` single-component and resolving a dependency's version from its tags across invocations. Rejected because it forces a rule for "which tag counts" when a snap carries several, and because it silently depends on the user having tagged strictly bottom-up in separate commands.

### 8. Assigned versions are exactly `major.minor.patch`

An assigned component version must be three numbers. Prereleases and build metadata are refused.

This subsumes reserving the generated `0.0.0-g<hex>` identifier shape — that shape is a prerelease, so it cannot be assigned either — and it is more general: it also removes the question of how a prerelease would order against the release it precedes, and keeps derived increments total. The reserved-shape check remains as the more specific diagnostic when a user pastes a snap identifier, because "that is a snap identifier" explains more than "prereleases are not allowed".

### 9. `snap` and `tag` share one command surface

Both commands gain the same three options, because both are one operation over a selection of components:

- `--dry-run` reports exactly what the command would do and writes nothing: no objects, no refs, no anchors. Preparation already separates cleanly from publication (decision 10), so a dry run is the prepare phase without the publish phase. Objects written during a dry run are unreachable and left to Git.
- `--json` emits the structured result both commands already build internally, with version identifiers unabbreviated.
- `--message` replaces the generated commit or tag message. Absent, each command keeps its current deterministic default. A message never affects whether a component is recorded: unchanged detection compares trees before any commit is created, so a custom message cannot conjure a version out of an unchanged component.

### 10. Materialize in memory, publish refs, then write back

```text
for each layer in dependency order:
  for each component in the layer:
    bytes = project(workspace .comp.json, bit-lite.json, resolved)
    assert every workspace dependency resolved (decision 5)
    prepared = prepareComponentSnap(store, component, { ".comp.json": bytes })
    resolved[packageName] = "0.0.0-g" + prepared.commitId

publishSnaps(store, prepared)          # one ref transaction, unchanged
writeBack(bit-lite.json)               # one file, only after publication succeeds
```

Committed bytes never equal disk bytes, so the history layer needs a way to substitute one captured file's content regardless. Given that entry point, materializing in memory costs nothing extra and preserves the existing guarantee that a failure leaves every ref and every workspace file untouched.

Because every anchor lives in one file, write-back is a single update that can be written to a temporary file and renamed into place, so a crash cannot leave some components' anchors updated and others' stale. The anchors are in any case a repairable mirror of the canonical refs rather than a source of truth, so a failed write-back costs a rerun and nothing else.

Dependency versions are resolved from the versions settled earlier in this same run, falling back to the store's canonical head refs. They are **not** read from the anchors, which go stale after a `sync` fast-forward.

### 11. The history layer stays workspace-agnostic

`bit-lite-history` continues to accept `{ componentId, rootDir }` and knows nothing about envs, package names, or dependency graphs. It exposes the two phases already implicit in `snapComponents` — prepare and publish — plus per-file content substitution. The command layer owns the workspace, the graph, the topological loop, the strictness checks, and the pure `project()` function. This keeps the projection trivially unit-testable and leaves the storage boundary where the existing design put it.

### 12. Generated package manifests carry versions, read from disk

`createGeneratedPackageManifest` writes a real version for a local dependency instead of `workspace:*`, and sets the manifest's own `version` from the component's anchor rather than the current hard-coded `"0.0.0"`. A component that has never been snapped contributes `0.0.0`.

Both values come from the anchors in `bit-lite.json`, which `readWorkspace` already loads before anything else, so `link` still never opens the history store. The manifest describes what is actually linked right now, which is the dependency's current version rather than anything recorded in history. After a `sync` fast-forward the anchors are briefly stale and so are these manifests; nothing consumes these versions today because resolution happens through symlinks.

## Risks / Trade-offs

- **[A component gets a new version with no visible change on disk]** — an env or dependency version moving produces a new snap for every dependent even when their source is untouched. This is correct and matches Bit, but until the companion inspection change lands, the only way to see why is to read the committed `.comp.json` out of the store. Mitigation: ship `component-history-inspection` next, and require it to attribute each snap to `source`, `deps`, or `env`.
- **[Recording cascades through the graph]** — one change to a low-level component produces new versions for everything above it. Mitigation: report changed and unchanged components as today, and make the change source visible in the inspection change.
- **[`snap` becomes a command that writes to the workspace]** — it now rewrites `bit-lite.json` to update version anchors. Mitigation: write back only after the ref transaction succeeds, touch only the anchors, and preserve the file's existing entry order and formatting so the diff shows nothing else.
- **[Every recording touches one shared workspace file]** — two people recording different components on different branches both modify `bit-lite.json`, so concurrent work conflicts there. This is the same property Bit's `.bitmap` has and is accepted rather than designed around; the conflicts are mechanical because the file is generated state, and the anchors can always be rebuilt from the store.
- **[The version anchor can disagree with the canonical head]** — `sync` can fast-forward a head while working files stay behind, after which snapping would record working content on top of a parent it was never based on, silently reverting the synced change. This change makes the disagreement *detectable* but does not yet act on it. See Open Questions.
- **[Snap versions look orderable but are not]** — `0.0.0-g…` parses as a valid semantic version, so a naive sort or "latest" computation will silently produce a wrong answer. Mitigation: state it in the spec, and never expose an ordering helper over these values.
- **[The version string drops the object-format qualifier]** — existing diagnostics report IDs as `sha1:<hex>` or `sha256:<hex>`, while `0.0.0-g<hex>` carries only the hex. A store has exactly one object format and `sync` requires matching formats, so the value is unambiguous where it is used. Mitigation: keep algorithm-qualified spellings in human-facing diagnostics.
- **[Committed `.comp.json` no longer matches the working file]** — any future comparison of a component against its history must compare projections rather than raw bytes. Mitigation: make `project()` the single shared entry point so the inspection change cannot accidentally compare the wrong forms.
- **[Strict `--filter` makes single-component snapping less convenient]** — a user wanting to record one component may be forced to name its dependencies too. Mitigation: the error names the missing or modified dependency and shows the corrected command.

## Migration Plan

1. Add the shared prerequisite/ordering definition to `bit-lite-context`, move `compile.ts` onto it, and correct or remove `orderWorkspaceComponents`. No behavior changes.
2. Teach `bit-lite-context` to read an optional `version` field on each `bit-lite.json` component entry, and to write those anchors back as one file update. Absent means "never snapped"; existing workspaces stay valid. Reject registering a component at the workspace root in the same step.
3. Add per-file content substitution to the history layer's snapshot and object creation, and expose the prepare/publish phases. Existing `snapComponents` behavior is preserved as a caller of them.
4. Add `project()` and the version formatter with unit tests, before wiring them into any command.
5. Move `snap` onto the topological loop with strictness checks and write-back.
6. Move `tag` onto projection-then-snap-if-changed, and reserve the `0.0.0-g` namespace in `assertComponentVersion`.
7. Update `link`'s generated manifests.
8. Update the demo workspace: `bit-lite.json` entries acquire a `version` anchor on their next snap. Existing stores need no migration — previously recorded snaps remain valid, they simply carry an unprojected `.comp.json`.

Rollback is additive at the command level: reverting the command-layer changes restores byte-for-byte capture. Snaps recorded under the projection remain readable; they are ordinary commits whose `.comp.json` happens to name resolved versions.

## Open Questions

- **Should `snap` refuse when a component's `version` anchor disagrees with its canonical head?** The `sync` fast-forward hazard above is real today, and the anchor introduced here is exactly what makes it detectable. Adding the guard is cheap, but it is a behavior this change did not set out to add, and the recovery path for a user who hits it (there is no `checkout`) is unclear. Deciding this may be better placed with `component-history-inspection`, where `status` will need to report the same disagreement.
- Whether components recorded before this change should be re-snapped so their history carries resolved dependency versions throughout, or whether a mixed history is acceptable. A mixed history is expected to be fine, since nothing yet reads recorded dependency versions back.

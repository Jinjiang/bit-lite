## Context

`tag` derives one version per component: the patch increment of the highest version that component already carries, or `0.0.1` for its first. `deriveNextComponentVersion` states why patch is the default — it is the only increment derivable without knowing what changed — and leaves minor and major to the user. The only way a user can currently state that intent is `--version`, which is refused when the selection resolves to more than one component.

Three properties of the existing code shape this design:

- `RecordingPolicy.assignVersion` is an async hook called once per selected component, and it is called **inside** the dependency-order traversal, immediately after that component's objects are prepared. `snap` and `tag` differ only in the policy they supply. A version decision made anywhere else has to reach this hook.
- The skip rule tests `prepared.commitId === undefined` — whether the projection changed the component's content at all. It does not look at *how much* any version changed. An explicit `--version` already bypasses the skip, because naming a version is a deliberate act.
- `prepareRecording` prepares every component's objects before any ref moves, and anchors are written only after publication succeeds. A failure anywhere leaves the store and the workspace untouched, and `--dry-run` is already the prepare phase without the publish phase.

`bit-lite-terminal` is an existing internal package providing raw-mode input, keypress handling, render scheduling, and terminal resize binding. `bit-lite-vendors` uses its `ManagedTerminal` in production. It is currently a devDependency of `bit-lite`. `install-reporter.ts` already establishes the convention of branching on `stream.isTTY`.

## Goals / Non-Goals

**Goals:**

- Let the user choose each component's increment — patch, minor, major, or an explicit version — for a release covering many components at once.
- Present the release as a whole before anything is written, including why each component is in it.
- Make the consequence of pulling a skipped component into the release visible at the moment it is made, not after execution.
- Keep the existing default exactly as it is: `tag` with no options still derives a patch increment per component.
- Preserve the all-or-nothing guarantee. Reviewing writes nothing; cancelling writes nothing.
- Keep the version decision testable without driving a terminal.

**Non-Goals:**

- A non-interactive `--bump` flag. Expressing per-component increments as flags is harder to use than the picker for the case that motivates the feature, and the no-flag default already covers scripted use. See decision 1.
- Changing what `--version` means. It stays the single-component explicit override it is today.
- Propagating intent along the graph. A dependency going major does not make its dependents major; see decision 6.
- Editing anything other than the version decision. The picker does not stage files, write messages, or change the selection's membership beyond including or excluding components.
- Replaying an interactive session non-interactively. Without `--bump` there is no spelling for the result, and inventing one only to print it would reintroduce the surface this change declines.

## Decisions

### 1. The capability is per-component increment selection; interaction is how it is reached

The gap is not "there is no TUI". It is that a release covering many components cannot state a different intent per component. A TUI is one front end over that decision; a flag is another.

The flag is rejected as a first front end rather than deferred. The case that motivates the change is a whole-workspace release in which increments genuinely differ, and expressing that as flags reads:

```text
tag --bump lib/math=major --bump ui/button=patch --bump ui/card=minor …
```

which is longer, harder to review, and harder to correct than the screen it replaces — for a case where the user is already at a terminal making a judgment call. A flag would be built, specified, and tested for a use it loses to the picker.

What is kept from the flag's motivation is the seam it implied: the decision is a value — a map from component to increment — produced by a front end and consumed by the recording policy. The picker builds that map from keystrokes; a test builds it directly. Nothing about the derivation knows a terminal exists.

Alternatives considered:

- **Ship `--bump` first and add the picker over it.** Rejected: it pays the cost of a surface the motivating case does not want, and a surface once shipped has to be supported.
- **Ship `--bump` only.** Rejected for the same reason, more strongly: it leaves the motivating case unserved.
- **Have the picker print an equivalent `--bump` line for reproducibility.** Rejected: it requires the flag to exist. Reproducibility of a release is what the store records; the input that produced it is not a durable artifact.

### 2. A version decision has two layers, and only one of them propagates

This is the observation the rest of the design rests on.

```text
shape      which components are in the release
           binary, propagates along the dependent graph

magnitude  which version each of them gets
           per component, does not propagate
```

**Magnitude never changes shape.** A component is skipped when its projection did not change its content. Whether a dependency moved from `0.0.1` to `0.0.2` or to `1.0.0`, its dependent's projected `.comp.json` names a different version than the one recorded, so the dependent's tree differs either way and it is in the release either way. The dependent's own version still derives from its own tags, so the dependency's magnitude does not reach it at all.

**Shape has exactly one user input.** A component is in the release when its own content changed, when it has never been released, or when the user pulled it in. Everything else follows:

```text
N = source changed  ∪  never released          (read from disk and store)
F = pulled in by the user                      (the only interactive input to shape)

in the release = dependent-closure(N ∪ F)
```

The consequence is that the plan can be computed once, and every magnitude edit afterwards is local: it changes the version string on one row and the bytes eventually recorded in that row's dependents, but it changes no row's presence. Only a change to `F` — including or excluding a component — can alter which rows exist.

Alternatives considered: treating every edit as invalidating the plan, which is correct but recomputes constantly and makes the screen feel unpredictable; and treating no edit as invalidating it, which is wrong the first time someone includes a skipped component and its dependents silently gain versions the screen never showed.

### 3. Plan, edit, execute

The decision point moves out of the traversal.

```text
① plan     traverse with the default policy, publishing nothing
           → rows: component, current version, default next version, why

② edit     present the rows; collect a decision per component
           → Map<componentId, Decision>   plus the set F

③ execute  traverse again with a policy that reads the decision map
           → prepare, publish refs, write anchors
```

Phase ① is what `--dry-run` already performs, so no new traversal mode is introduced. Phase ③ is the ordinary recording path with a different policy, which is what `RecordingPolicy` exists for.

Two traversals rather than one is the price of showing the whole release before deciding any of it, and decision 2 is what makes the two agree: phase ①'s shape stays correct under every magnitude edit, so the plan the user approved is the plan phase ③ carries out.

Phase ① writes objects that phase ③ mostly writes again. They are unreachable until a ref moves, exactly as a dry run's are today, and Git collects them. Correctness does not depend on their being distinct.

### 4. Shape is recomputed, not predicted

When the user includes or excludes a component, the affected dependents are found by re-running phase ① with the new `F`, not by walking the dependency graph in the picker.

|  | Predict on the graph | Re-run phase ① |
| --- | --- | --- |
| Cost | In memory | One traversal, unreachable objects |
| Agreement with phase ③ | Two implementations of one rule | One implementation |

The risk the table understates is where a disagreement lands. If the picker's prediction and the traversal's answer differ, the user approves one release and receives another, in immutable history. Prediction is a worthwhile optimization once the rule is settled and covered by tests; it is a poor thing to be doing on the first implementation, and it is not needed for correctness at any workspace size this project targets.

Should the picker later predict, phase ③ must assert that the shape it computes matches the shape that was approved and abort otherwise, so a drift becomes an error rather than a wrong release.

### 5. The increment becomes a parameter of the derivation

`deriveNextComponentVersion` takes the increment it applies instead of hard-coding `patch`, defaulting to `patch` so every existing caller is unchanged. An explicit version bypasses derivation entirely and is validated by `assertComponentVersion` exactly as `--version` is today, so the three-number rule and the reserved snap-identifier namespace apply to an interactively chosen version without a second code path.

Keeping the derivation a pure function of `(existing versions, increment)` is what makes the decision testable without a terminal.

### 6. Selection overrides the skip, exclusion narrows the operation, and intent does not propagate

Pulling a component into the release overrides the skip rule, generalizing the existing behaviour of `--version`: the user named this component deliberately, and a deliberate act outranks a derivation about whether anything is new.

Excluding a component is not the mirror of that, and the difference matters. It cannot be handled while versions are assigned, because by then the component's objects are prepared and publication moves its head — it would be left carrying a generated snap identifier rather than the version it had, which is the opposite of leaving it alone. Exclusion therefore **narrows the selection** before the traversal runs, making the component an ordinary out-of-selection prerequisite.

That reuses a rule rather than adding one, and it inherits that rule's refusal: if an excluded component's working content differs from its head and something still in the release depends on it, the operation fails. This is correct and worth stating plainly. The dependent must record which version of that component it was built against; the only version available is the one at the unchanged head, while the code on disk is newer, so the record would assert a combination that was never assembled — and a component version cannot be withdrawn once assigned. The diagnostic is the one `--filter` already produces, including its suggestion to put the component back in the selection.

The consequence is that exclusion is not always available. That is a property of the guarantee, not a gap: a user who wants that component left alone must either not have changed it, or exclude its dependents too.

Intent, by contrast, stops at the component it was stated for. A dependency going major does not make its dependents major, because a break in a dependency's API is not a break in its dependent's API — the dependent may have absorbed the change entirely. Propagating would also raise questions with no good answer: how many levels, and what happens where the user already chose something else.

This is precisely where a whole-release screen earns its place. The dependents of a major bump are visible as rows, defaulted to patch, and one keystroke each changes any of them. Automatic propagation would replace a decision the user can see with one they cannot.

### 7. `--interactive` requires a terminal and refuses otherwise

Without a TTY on both input and output, `--interactive` fails with a diagnostic naming the condition. It does not hang waiting on a pipe, and it does not silently fall back to the patch default — a command that writes immutable history must never quietly assign versions the user was meant to choose.

The fallback is already spelled: omit `--interactive` and every component takes a patch increment.

### 8. `--interactive` composes with `--dry-run` and refuses `--json`

`--dry-run` with `--interactive` runs phases ① and ②, reports the approved plan, and stops before ③. This is the natural rehearsal, and it costs nothing to support because phase ③ is already the only phase that writes.

`--json` with `--interactive` is refused. `--json` exists so another program can consume the result, and a program cannot answer the picker. Refusing is clearer than defining which stream the interface would render on.

`--version` with `--interactive` is refused as contradictory: one states the answer, the other asks for it.

### 9. Reuse the terminal package's plumbing, not its menu

`bit-lite-terminal` already solves raw mode, keypress decoding, render scheduling, resize binding, and restoring the terminal on exit — the parts that are easy to get subtly wrong. Those are reused, and `bit-lite` promotes it from devDependency to dependency.

`ManagedTerminal` itself is not reused. Its model is a list of long-running processes to attach to and detach from, with up/down/return/escape as navigation; the picker's model is a table of rows each carrying an editable value. Bending one into the other would leave both harder to read than a second component built on the shared plumbing.

### 10. The screen states why each component is in the release

Each row names the reason its component is present — its own source changed, a dependency moved, its env moved, or it has never been released — using the change-source vocabulary the `component-history-inspection` capability defines for `status --detail`. That capability already computes this from recorded and projected metadata, and defining a second vocabulary for the same facts would let the picker and `status` disagree about the same workspace.

The reason is what makes a per-component decision possible: "my source changed" and "a dependency moved" call for different increments, and without the distinction the screen is a list of names.

## Risks / Trade-offs

- **[Two traversals per invocation]** — every interactive run prepares objects twice, and each shape edit prepares them again. Mitigation: preparation is already what `--dry-run` costs, the objects are unreachable and collected by Git, and decision 4 records prediction as the optimization to reach for, behind an equality assertion.
- **[A TUI is harder to test than a flag]** — keystroke-driven behaviour resists the plain-function tests the rest of this codebase uses. Mitigation: the decision map is the seam. Derivation, shape computation, and the recording policy are tested by constructing the map directly; only rendering and key handling need the terminal, and `bit-lite-terminal` already takes injectable `stdin`/`stdout`, as `vendor-task.test.ts` demonstrates.
- **[The screen can grow past a viewport]** — a large workspace produces more rows than fit. Mitigation: the row set is the release, not the workspace, and the skip rule keeps it to components with something new; scrolling is still required and is part of this change rather than a follow-up.
- **[A user can assign a lower version than a component carries]** — an explicit version chosen in the picker could sort below an existing tag. Mitigation: the same validation `--version` passes through applies, and tags are immutable and idempotent, so the failure mode is a refused or duplicate tag rather than a corrupted history. Whether to refuse a decrease outright is an open question.
- **[Interactive selection is a second way to reach an immutable outcome]** — versions chosen at a keyboard cannot be withdrawn any more than derived ones can. Mitigation: nothing is written before the user confirms, `--dry-run` rehearses the whole thing, and the screen states the exact versions before they are assigned.
- **[Promoting `bit-lite-terminal` to a dependency widens the runtime surface]** — a package previously loaded only in tests and by `vendors` now loads in a core command's path. Mitigation: it is workspace-internal with no external dependencies, and it is imported only when `--interactive` is supplied.

## Migration Plan

1. Give `deriveNextComponentVersion` an increment parameter defaulting to `patch`. No behaviour changes; every existing caller keeps its result.
2. Introduce the decision map and a policy that reads it, with the existing derivation as the default for any component the map does not mention. `tag` still has no new option; the policy is exercised by tests.
3. Split `runTagCommand` into plan and execute phases over the existing traversal, with the current behaviour expressed as "plan, then execute with an empty decision map". `--dry-run` becomes "plan only".
4. Add shape recomputation for an inclusion or exclusion, still without an interface, verified by constructing `F` directly.
5. Build the picker on `bit-lite-terminal`'s plumbing, with injectable streams, and promote the package to a dependency.
6. Wire `--interactive`, including the TTY requirement and the `--json` and `--version` refusals.

Rollback is removing the option: the derivation's new parameter defaults to the old behaviour, and the phase split is internal.

## Open Questions

- **Should an explicit version lower than the component's highest existing version be refused?** Tags are immutable and idempotent, so the damage is bounded, but a decreasing version is more likely a mistake than an intent. Refusing is easy; the argument against is that this change should not quietly add a rule `--version` does not have.
- **Should excluding a component cascade to its dependents the way including one does?** Settled for the case that forced it, in decision 6: excluding an *unchanged* component is allowed and its dependents record the version it already carries, while excluding a *changed* one whose dependents remain in the release is refused. What stays open is whether the interface should offer to exclude the dependents as well when it hits that refusal, rather than only reporting it.
- **What does the picker do when the plan is empty?** Every component skipped is a legitimate outcome of a repeated `tag`. Showing an empty screen to confirm is noise; reporting "nothing to release" and exiting matches the non-interactive path, but then `--interactive` sometimes shows no interface.
- Whether the reason column should distinguish "a dependency moved" from "a dependency was pulled into this release", which are the same fact to `status` but different decisions to the user.

## Context

`packages/bit-lite/src/utils` grew from 1,177 to 2,018 lines of non-test code during `component-history-inspection`. Measured by content rather than file count:

| | Lines |
| --- | --- |
| Domain logic — vendor orchestration, unified diff, and the three versioning files | 1,871 |
| Utilities — errors, option reading, selection, watch contribution, workspace preparation | 147 |

A directory conventionally holding small, weakly-coupled helpers is 93% something else.

The versioning files are the ones with a clear destination. Their imports close over each other and reach outward only to the two layers they sit between:

```text
component-projection.ts       bit-lite-context, bit-lite-utils
component-recording.ts        bit-lite-context, bit-lite-history, ./component-projection
component-metadata-diff.ts    bit-lite-context, bit-lite-history, ./component-projection
component-inspection.ts       bit-lite-context, bit-lite-history, ./component-projection,
                              ./component-metadata-diff
```

Plus one import each of `./errors.js`, which is the only thread tying them to the CLI package.

`bit-lite-history` demonstrates the value of the arrangement. It grew by 1,600 lines during the same change and still depends on nothing but `bit-lite-utils` and `semver`; its new `inspect.ts` contains no workspace references. It stayed clean because the package boundary made the alternative unavailable, not because anyone remembered.

## Goals / Non-Goals

**Goals:**

- Give the versioning layer a package, so its position between the workspace model and the component store is stated by its dependencies rather than inferred from its imports.
- Make "one projection, shared by producing and comparing" a property of the package rather than a convention two files happen to follow.
- Leave `utils` holding utilities.
- Change no observable behavior: every existing test passes unmodified.

**Non-Goals:**

- Moving `vendor-execution.ts`. It is the largest thing left in `utils` and it does not belong there either, but vendor task orchestration is a separate domain with separate consumers; bundling it here would make one diff out of two unrelated moves.
- Changing what the projection produces or what the comparison reports. `component-version-resolution` and `component-history-inspection` specify both, and neither requirement's substance changes.
- Extracting env resolution or argument parsing. That is `realign-workspace-package-boundaries`, which this change depends on.
- Introducing a second error type or an error hierarchy. The consolidation here is deduplication, not design.

## Decisions

### 1. One package for producing and comparing, not two

Producing a recorded component and comparing two of them look like different jobs, and an earlier reading of this code would have split them: recording on the write side, inspection on the read side. They belong together because they share the definition that makes both correct.

`component-history-inspection` requires that an empty `diff` means the next `snap` reports the component unchanged. That holds only because both sides project working content through the same function. Split across packages, the shared definition becomes a dependency one of them could replace; in one package it is the package's reason to exist.

The two traversals are deliberately different, which is easier to see with them side by side than apart:

```text
recording     orderComponentsByPrerequisites(workspace, closure)   restricted to the selection's
                                                                   closure; refuses what it cannot resolve
inspection    orderComponentsByPrerequisites(workspace)            walks the whole workspace, then
                                                                   filters the report
```

That difference is required — `status --filter` reports a prerequisite problem outside the selection where `snap` refuses — and it is the same traversal pattern under two policies. Keeping the pattern visible in one place is worth more than separating the directions.

### 2. Unified-diff goes to the utility package, not the versioning package

`unified-diff.ts` has no imports at all. It takes two file sets and returns patch text. It sits in `utils` today because that is where things go when nothing else claims them, and it would sit in the versioning package for the same reason.

`bit-lite-utils` already exists for exactly this, and `shared-utility-library` already specifies it as the home for canonical helpers that operate on consumer-owned data through structural types. Patch formatting fits without qualification.

Alternative considered: keeping it beside the `diff` command, since that is its only caller. Rejected because a pure serializer with no dependencies is the clearest possible case for the shared package, and single-caller status is a fact about today.

### 3. `BitLiteError` gets one definition

`BitLiteError` is declared identically in `packages/bit-lite/src/utils/errors.ts` and `packages/bit-lite-context/src/utils/errors.ts` — same class, same three lines, twice. The new package needs it too, and importing the CLI's copy would invert the dependency.

So the move forces a choice between a third copy and consolidation. `bit-lite-utils` is where this repository already puts canonical helpers, and `shared-utility-library` maintains the list. Adding `BitLiteError` to it is deduplication that the move surfaces rather than a design change it introduces.

This is the one part of the change that touches packages beyond the ones being moved, so it is worth doing deliberately rather than as a side effect: both existing declarations are removed and their importers repointed, so no fourth copy can appear later by following local precedent.

### 4. Land after the boundary realignment

`realign-workspace-package-boundaries` should merge first, for two reasons.

Its extraction of env resolution means the versioning package can depend on a base workspace model that carries only the workspace model. Declared against today's `bit-lite-context`, the dependency would say the versioning layer depends on env resolution — false, and exactly the kind of false statement these two changes exist to remove.

Its removal of the projection's own file read also lands first, which means the projection arrives here as a pure in-memory transformation with no filesystem access of its own. Moving it afterwards is moving a smaller, simpler thing.

## Risks / Trade-offs

- **[A pure move produces a large diff that hides an accidental edit]** → Keep it a move: no renames, no signature changes, no behavior edits in the same commits. Verify by comparing test results against a pre-move baseline rather than against expectations.
- **[The package name claims more than it holds]** → `bit-lite-versioning` covers producing versions, comparing them, and explaining them, which is what the four files do. If checkout or import land later they belong here too, so the name has room rather than excess.
- **[Consolidating `BitLiteError` touches packages this change otherwise leaves alone]** → It is forced by the move and the alternative is a third copy. Doing it here, with both old declarations removed, is what stops the duplication from growing.
- **[`utils` still holds `vendor-execution.ts` afterwards]** → True, and it will still be misplaced. Leaving it is deliberate: one misplaced file is easier to see and move than one buried among five.
- **[Two packages now sit between the CLI and the store]** → The layering is deeper, but each layer's dependencies now state what it actually needs. Depth that is legible is cheaper than a flat arrangement that is not.

## Migration Plan

1. Land `realign-workspace-package-boundaries` first.
2. Add `BitLiteError` to `bit-lite-utils`, repoint both existing importers, and delete both local declarations.
3. Create the versioning package with its manifest, TypeScript configuration, and vitest configuration, wired into the workspace build.
4. Move the four files and their tests unchanged, and give the package an export surface covering what the commands use.
5. Repoint `snap`, `tag`, `status`, `log`, and `diff`.
6. Move patch formatting to `bit-lite-utils` and repoint the `diff` command.
7. Run the full build, typecheck, and every package's tests, confirming results match the pre-move baseline.

Rollback is a revert. Nothing on disk or in the component store changes, so there is no state to migrate either way.

## Open Questions

- Whether `vendor-execution.ts` should get the same treatment in a later change. It is the last large domain file in `utils`, and the argument for moving it is the same one made here — but its consumers, its lifecycle ownership, and its worker boundary make it a bigger question than relocation.

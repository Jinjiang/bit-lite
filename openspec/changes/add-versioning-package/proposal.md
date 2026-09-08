## Why

`packages/bit-lite/src/utils` holds 2,018 lines of non-test code, and 1,871 of them are domain logic rather than utilities. Five files carry that weight: vendor task orchestration, unified-diff serialization, and three files that together implement component versioning. What is left over — error construction, option reading, selection, a watch contribution type — is 147 lines, or 7% of the directory.

The versioning code is the part that has a home to go to. Four files form one closed set:

```
component-projection.ts      169   produce the recorded form
component-recording.ts       238   orchestrate producing it
component-inspection.ts      269   orchestrate comparing it
component-metadata-diff.ts   235   compare recorded forms, attribute the change
                            ────
                             911
```

They import each other and nothing else from the CLI except an error class. Externally they reach only `bit-lite-context`, `bit-lite-history`, and `bit-lite-utils` — the two sides they translate between. That is a package, sitting in a directory named for the opposite.

The pairing is not incidental. Producing a recorded component and comparing two of them are the same problem read in two directions, and `component-history-inspection` depends on them sharing one projection: an empty `diff` means the next `snap` reports the component unchanged, which holds only because both call the same function. Today that is a convention — two files importing the same relative path. In one package it is what the package is for.

## What Changes

- Add a `bit-lite-versioning` package holding the projection, the recording traversal, the comparison core, and metadata comparison with change-source attribution. It depends on `bit-lite-context` and `bit-lite-history`, which is exactly the translator position between the workspace model and the component store.
- Move unified-diff serialization to `bit-lite-utils`. It has zero imports and no domain knowledge — it turns two file sets into patch text.
- Give `BitLiteError` one definition. It is currently declared identically in `packages/bit-lite` and `bit-lite-context`, and the new package would otherwise need a third copy. `bit-lite-utils` already exists to hold exactly this kind of canonical helper.
- Leave `vendor-execution.ts` alone. At 649 lines it is the largest remaining occupant of `utils`, but it is vendor task orchestration — a different domain needing a different move.
- Nothing observable changes. Every existing test must pass unmodified.

## Capabilities

### New Capabilities

None. What the projection produces is already specified by `component-version-resolution`, and what the comparison reports is already specified by `component-history-inspection`. This change moves the implementation without changing either.

### Modified Capabilities

- `component-version-resolution`: the projection gains a single-definition requirement — every operation that produces or compares recorded component content uses one implementation, rather than each caller being trusted to reach for the same one.
- `shared-utility-library`: `BitLiteError` joins the canonical helper list, since three packages now need it and duplicating it a third time is the alternative.

## Impact

- Adds one workspace package and moves 911 lines into it, leaving `packages/bit-lite/src/utils` holding utilities plus `vendor-execution.ts`.
- `packages/bit-lite`: `snap`, `tag`, `status`, `log`, and `diff` import the versioning layer instead of reaching into `utils`; the `diff` command imports patch formatting from `bit-lite-utils`.
- `packages/bit-lite-utils`: gains patch formatting and the canonical error class.
- `packages/bit-lite-context` and `packages/bit-lite` both drop their local `BitLiteError` declaration in favor of the canonical one.
- Package manifests, TypeScript project references, and export surfaces change; no runtime behavior does.
- Depends on `realign-workspace-package-boundaries` landing first, so the new package can depend on a base workspace model that does not carry env resolution, and so the projection is already free of its own file read.

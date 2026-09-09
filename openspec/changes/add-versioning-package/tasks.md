## 1. Prerequisites and baseline

- [x] 1.1 Confirm `realign-workspace-package-boundaries` has landed, so the base workspace model carries no env resolution and the projection no longer reads `.comp.json` itself
- [x] 1.2 Record the pre-move results of `pnpm build`, `pnpm typecheck`, and every package's test suite as the baseline the post-move run is compared against

## 2. Give `BitLiteError` one declaration

- [x] 2.1 Add `BitLiteError` to `bit-lite-utils` with the behavior both existing declarations already have
- [x] 2.2 Repoint every importer in `packages/bit-lite` and `bit-lite-context`, and delete both local declarations so no package can be copied from
- [x] 2.3 Confirm error messages and the `name` property are unchanged, since diagnostics are asserted by existing tests

## 3. Create the versioning package

- [x] 3.1 Add the package directory with its manifest declaring `bit-lite-context`, `bit-lite-history`, and `bit-lite-utils`, and no dependency on env resolution
- [x] 3.2 Add its TypeScript configuration and build script, and wire it into the workspace build and typecheck runs
- [x] 3.3 Add its vitest configuration so the tests moving into it keep running

## 4. Move the versioning layer

- [x] 4.1 Move `component-projection.ts`, `component-recording.ts`, `component-metadata-diff.ts`, and `component-inspection.ts` into the package unchanged, along with their tests
- [x] 4.2 Give the package an export surface covering what the commands consume, and keep internal helpers unexported so the shared traversal and projection stay internal detail
- [x] 4.3 Export one projection function and confirm both the recording traversal and the comparison core call it, rather than either deriving recorded content another way
- [x] 4.4 Repoint `snap`, `tag`, `status`, `log`, and `diff` at the package

## 5. Move patch formatting

- [x] 5.1 Move `unified-diff.ts` and its tests to `bit-lite-utils`, keeping the exported names
- [x] 5.2 Repoint the `diff` command, and confirm the helper still declares no imports so it stays valid for the shared package

## 6. Verification

- [x] 6.1 Confirm the versioning package's manifest names no env-resolution dependency, so the recording and inspection layer is structurally independent of installation state
- [x] 6.2 Run the full `pnpm build` and `pnpm typecheck` and confirm both are clean
- [x] 6.3 Run every package's test suite and confirm results match the section 1 baseline exactly, with no test edited to accommodate the move
- [x] 6.4 Add a test asserting a recording operation and a comparison operation derive identical recorded content for the same workspace state, so the shared projection is checked rather than assumed
- [x] 6.5 Confirm `packages/bit-lite/src/utils` afterwards holds only utilities plus `vendor-execution.ts`
- [x] 6.6 Exercise the demo workspace end to end — install, link, compile, snap, tag, status, log, diff — and confirm behavior is unchanged
- [x] 6.7 Update the README's package table with the new package and its position between the workspace model and the component store

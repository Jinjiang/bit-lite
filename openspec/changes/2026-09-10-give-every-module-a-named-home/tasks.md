## 1. Baseline

- [x] 1.1 Record the pre-change results of `pnpm build`, `pnpm typecheck`, and every package's test suite, so the post-change run is compared against a known-good baseline rather than against expectations
- [x] 1.2 Note what is already broken, so a pre-existing failure is not mistaken for a regression: in `bit-lite`, `commands/test.test.ts` kills its pool worker with `Worker exited unexpectedly` after the third test — the one that starts worker-backed watch tasks — so the four tests after it never run and are reported as pending rather than failed. `demo-vendors`' compiler watch test is separately timing-sensitive under a full recursive run
- [x] 1.3 Record that this is a standing defect and not this change's to fix, while noting that moving the contract test into `bit-lite-tester` takes one of those four out of the dead region and it now runs

## 2. Let a declaration mean an import

- [x] 2.1 Remove `bit-lite-env` from `bit-lite`, `bit-lite-context`, and `bit-lite-vendors`, none of which import it
- [x] 2.2 Move `bit-lite-terminal` to `bit-lite`'s development dependencies, since only one test imports it and production reaches the managed terminal through `bit-lite-vendors`
- [x] 2.3 Assert for every source-bearing package that a declared workspace dependency appears in an importing position in production source
- [x] 2.4 Assert the reverse — a workspace package reached from any source, tests included, is declared — since that is what makes removing a declaration safe under pnpm
- [x] 2.5 Match specifiers only in an importing position and only up to the closing delimiter, so a package named as data is not counted and `bit-lite-env` does not match `bit-lite-env-resolution`
- [x] 2.6 Scope the rule to packages with TypeScript sources, and say why the JSON env packages are outside it
- [x] 2.7 Confirm each rule fails when violated, by reintroducing a stale declaration and a phantom import in turn

## 3. Give the test service a contract package

- [x] 3.1 Add `bit-lite-tester` with the manifest, tsconfig, and dependency set of `bit-lite-compiler`, and nothing more
- [x] 3.2 Declare `TestServiceResult`, `TestComponentResult`, `TestStats`, and `TestVendorMode` once, with the guards that admit a result at the process boundary
- [x] 3.3 Add `TesterVendorRuntime`, which both reference testers were spelling out, and no vendor-module guard, which nothing calls
- [x] 3.4 Repoint `bit-lite/src/commands/test.ts` and `test-routes.ts` at the package and delete their local declarations
- [x] 3.5 Repoint `demo-vendors`' reference testers and delete the declarations in `testers/result.ts`
- [x] 3.6 Delete `demo-vendors/src/samples/test-result.ts`, the third declaration, and repoint the sample vendors
- [x] 3.7 Move the guard's extensibility test out of the `test` command's suite, since it describes the guard rather than the command
- [x] 3.8 Cover both guards and the shapes they contain directly in the new package

## 4. Move two modules to the packages that own them

- [x] 4.1 Move `version-decision.ts` into `bit-lite-versioning` and export it, confirming no new dependency is required
- [x] 4.2 Repoint `tag.ts`, `tag-selection.ts`, and their tests, merging the duplicate import blocks the move exposed
- [x] 4.3 Move `openRecordedHistory` beside `openComponentHistoryStore` in `bit-lite-history` and export it
- [x] 4.4 Repoint `status`, `log`, and `diff`, and confirm `history-independence.test.ts` still holds them to the read-only gate
- [x] 4.5 Replace the assertion that read the gate's source with tests of its behavior: an unrecorded workspace answers `undefined`, asking creates nothing, and an existing store opens rather than being duplicated

## 5. Replace `utils` with the layers it was hiding

- [x] 5.1 Create `cli/`, `session/`, and `execution/`, and move each module to the layer that describes it
- [x] 5.2 Move `declarations.ts` and `help-text.ts` out of `commands/` into `cli/`, neither having been a command
- [x] 5.3 Move `assertNoSwallowedComponents` into `args.ts`, beside the parser that records `consumedBareWords` and defers the decision
- [x] 5.4 Narrow its second parameter to the component IDs it reads, so `cli/` depends on the workspace model not at all
- [x] 5.5 Move its tests to the parser's suite, where the deferred judgement is described
- [x] 5.6 Merge `prepare-workspace.ts` into `commands/selection.ts`, its only consumer, and say why a composition of commands belongs among them
- [x] 5.7 Type `createEnvServiceExecutionPlan`'s input as the env groups it reads, removing the execution layer's last reference to the command layer
- [x] 5.8 Repoint every import across 17 command modules, the CLI entry, and 29 test files
- [x] 5.9 Assert that every import inside the package points downwards through the layers, that `cli/` reaches no workspace package, and that no directory exists the layer list does not name
- [x] 5.10 Confirm each of those three rules fails when violated

## 6. State the remaining two boundaries

- [x] 6.1 Make `react` and `react-dom` optional peer dependencies of `bit-lite-preview`, and development dependencies for its own tests, matching `demo-config`
- [x] 6.2 Confirm the install reports no unmet peer, since `bit-lite` uses only the node entry
- [x] 6.3 Leave `typescript` an ordinary dependency and record why: the node entry parses a demo file's syntax at runtime
- [x] 6.4 Dissolve `bit-lite-context/src/utils`, moving `patterns.ts` up and keeping `normalizeRelativePath` private to it
- [x] 6.5 Import `toPosixPath` from `bit-lite-utils/node` directly rather than through a re-export, and confirm the package's export surface is unchanged

## 7. Verification

- [x] 7.1 Run `pnpm build` and `pnpm typecheck` after each step and confirm both stay clean
- [x] 7.2 Run every package's test suite and account for every difference from the section 1 baseline by the tests deliberately moved or added
- [x] 7.3 Confirm no existing assertion was weakened or adjusted to make a move work: of 30 changed test files, 22 change only an import specifier, and every substantive change is a deliberate relocation or addition — the guard tests to the parser's suite, the contract test to `bit-lite-tester`, the gate's source-grep replaced by behavior in `store.test.ts`, and the two new structural suites
- [x] 7.4 Exercise the demo workspace end to end and confirm behavior is unchanged: install, link, compile, all three test services, `preview` serving every env's server, `start` with compile and test watch under one session and a clean SIGINT shutdown that releases the port, and `sync` reporting no configured remote
- [x] 7.5 Confirm `status` answers "never recorded" in a workspace with no store and creates none, then `snap`, `tag` with a derived and an explicit version, the reserved snap-identifier refusal, `log`, and `diff` against both a clean and a modified component
- [x] 7.6 Mount a React composition in the browser and change its state, confirming the preview runtime and the env's compositions share one React instance now that it resolves as a peer
- [x] 7.7 Update the root README's package table with `bit-lite-tester` and the rule it completes, and the CLI package's README with the source layout
- [x] 7.8 Record the moved APIs in the READMEs of the packages that now own them, and why React is an optional peer of `bit-lite-preview`

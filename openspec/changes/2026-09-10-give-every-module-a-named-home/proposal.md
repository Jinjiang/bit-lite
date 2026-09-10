## Why

`2026-09-09-realign-workspace-package-boundaries` moved the resolved phase into its own package and named two things it deliberately left alone: `utils/vendor-execution.ts`, at the time the largest thing in `packages/bit-lite/src/utils`, and the question of what else that directory was holding. This change answers it, and finds the same pattern in three other places.

The pattern is a boundary that exists but is not stated, so nothing keeps it true.

**The `utils` drawer had four layers in it.** Nine modules between 13 and 569 lines shared nothing but the absence of a better idea:

| Module | Lines | What it actually is |
| --- | --- | --- |
| `vendor-execution.ts` | 569 | The `vendor-command-execution` capability |
| `version-decision.ts` | 96 | Versioning rules `tag` collects a choice for |
| `command-selection.ts` | 77 | Two commands composed into a resolved selection |
| `disposal.ts` | 65 | Half of `watch-session-lifecycle` |
| `command-options.ts` | 50 | Part of `cli-command-surface` |
| `no-tasks.ts` | 23 | One command's output, shared with a second |
| `prepare-workspace.ts` | 20 | `link` and `compile`, run in order |
| `component-store.ts` | 19 | The read-only gate on the history store |
| `watch-contribution.ts` | 13 | The other half of `watch-session-lifecycle` |

Two of those are specified capabilities in their own right. Two belong to other packages entirely. And the ordering had already failed: `prepare-workspace.ts` imported `commands/link.ts` and `commands/compile.ts`, while `compile.ts` imported back through `command-selection.ts` — a cycle through three modules, hidden because nobody claimed the directory sat anywhere in particular.

**Three manifests granted reach nothing used.** `bit-lite`, `bit-lite-context`, and `bit-lite-vendors` each declared `bit-lite-env` and never imported it. `package-boundaries.test.ts` argues that a base-phase package *cannot* reach env resolution because the dependency is absent rather than discouraged. That argument is only as good as the manifests, and three of their lines had stopped meaning anything.

**One env service had no home for its contract.** Compile has `bit-lite-compiler` and preview has `bit-lite-preview`. Test had nothing, so `TestServiceResult` was declared three times: in the reference testers, in the sample vendors, and in the `test` command that validates what comes back. A vendor authored outside this repository had nowhere to import the shape from.

**One dependency was stated more strongly than it is true.** `bit-lite-preview` declared `react` and `react-dom` as ordinary dependencies, so `bit-lite` installed them although it only ever imports `bit-lite-preview/node`. React is a peer for a reason beyond weight: the browser runtime and the env's compositions must use the same instance.

## What Changes

- Delete the three unused `bit-lite-env` declarations and move `bit-lite-terminal` to `bit-lite`'s development dependencies, where one test's use of it belongs. Assert both directions — declared means imported, imported means declared — for every source-bearing package.
- Add `bit-lite-tester`, mirroring `bit-lite-compiler` exactly, and delete the three declarations of the test result shape in favour of it. **BREAKING** for internal imports: the `test` command and the reference testers import the shape from the new package.
- Replace `packages/bit-lite/src/utils` with `cli`, `session`, `execution`, and `commands`, and assert that imports only travel downwards through them and that no unnamed directory exists.
- Break the three-module cycle by moving `assertNoSwallowedComponents` to `args.ts`, beside the parser that defers to it, and merging `prepare-workspace.ts` into its only consumer.
- Move `version-decision.ts` to `bit-lite-versioning` and `openRecordedHistory` to `bit-lite-history`, neither of which needs a new dependency to accept it.
- Make `react` and `react-dom` optional peer dependencies of `bit-lite-preview`, matching how `demo-config` already declares them.
- Dissolve `bit-lite-context/src/utils`, whose two files existed largely to re-export `toPosixPath` under a second name.
- Nothing observable changes. No existing test is edited to accommodate a move.

## Capabilities

### New Capabilities

None. Where a module lives is not a behavior, and the three moved contracts — the test result shape, the version decision rules, and the read-only store gate — are each already specified by `env-service-execution`, `interactive-version-selection` together with `component-version-tags`, and `component-history-inspection` respectively.

### Modified Capabilities

- `env-service-execution`: gains the requirement the compile and preview services already satisfied — each service's result shape ships from one package, depending on nothing but the vendor runtime and the shared utilities.
- `workspace-context-model`: the base/resolved package boundary gains the rule that makes it enforceable — a declared workspace dependency is one the package imports, and an imported one is declared.
- `vendor-command-execution`: an env-service plan states that it reads env groups rather than naming the command-selection type, so the execution layer no longer refers upward to the command layer.
- `shared-utility-library`: gains the rule that `bit-lite-utils` is the workspace's only place named for utility, and that a package arranging its modules in layers must assert the arrangement rather than only describe it.

## Impact

- Adds one workspace package of 93 lines for the test contract, and removes all three of the declarations it replaces.
- `packages/bit-lite`: `src/utils` is gone; 17 command modules, the CLI entry, and 29 test files change where they import from. `declarations.ts` and `help-text.ts` move out of `commands/`, having never been commands.
- `packages/bit-lite-versioning` and `packages/bit-lite-history` each gain one module and its exports.
- `packages/demo-vendors`: the reference testers and two sample vendors import the test contract from its package.
- `packages/bit-lite-context`: `src/utils` is gone and one import shortens.
- Three package manifests lose a dependency, one gains a peer, and one is added.
- Adds two structural assertions — the manifest rule across packages, the layer rule within the CLI — so both stop depending on reviewers remembering them.

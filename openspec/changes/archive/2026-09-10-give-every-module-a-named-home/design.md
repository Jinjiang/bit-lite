## Context

Counting `packages/bit-lite` against the rest of the workspace:

| Package | Source lines |
| --- | --- |
| `bit-lite` | 6,018 |
| `bit-lite-history` | 2,931 |
| `bit-lite-preview` | 1,538 |
| `bit-lite-vendors` | 1,433 |
| everything else, combined | 4,733 |

The CLI is 36% of the workspace's source and depends on every other package in it. Inside, `commands/` held 4,674 lines across seventeen files and `utils/` held 932 more across nine. `commands/` at least says what it contains. `utils/` said only that a decision had been deferred.

That is not an aesthetic complaint. Three things followed from it.

**A cycle.** `commands/compile.ts` imported `assertNoSwallowedComponents` from `utils/command-selection.ts`, which imported `prepareWorkspaceForEnvLoading` from `utils/prepare-workspace.ts`, which imported `compileComponentPackages` back from `commands/compile.ts`. ES modules tolerate it, and nothing pointed at it, because a directory that claims no position in a layering cannot be said to have violated one.

**Two modules stranded in the wrong package.** `version-decision.ts` is 96 lines of versioning rules — the three-number gate an explicit version passes, what overrides a skip, why an exclusion narrows the selection — importing only `bit-lite-history` and `bit-lite-utils`, both already dependencies of `bit-lite-versioning`. `component-store.ts` is the gate that keeps three commands from creating a history store by asking whether one exists; from the CLI it could only guard the three commands that remembered to call it.

**An execution engine filed as a helper.** `vendor-execution.ts` is 569 lines implementing `vendor-command-execution`, a capability with its own spec. The previous boundaries change named it as future work; this is that work.

The other three findings are the same shape in different places. A manifest that declares a dependency nobody imports states a boundary nobody decided to open. A service protocol with no package to live in gets written once per participant. A dependency declared as ordinary when it is a peer states a relationship stronger than the truth.

## Goals / Non-Goals

**Goals:**

- Give every module in `packages/bit-lite/src` a directory named for what it does, and make the resulting order a fact rather than a description.
- Remove the cycle by moving the two modules that caused it to where they belong, not by adding an indirection.
- Make a declared workspace dependency mean the package imports it, in both directions, for every source-bearing package.
- Give the test service the one contract package the other two services already have.
- State `bit-lite-preview`'s React relationship as the peer dependency it is.
- Change no observable behavior. No existing test is edited to accommodate a move.

**Non-Goals:**

- Splitting `packages/bit-lite` into more packages. Its size is a consequence of being the only executable in the workspace; the fix for 6,018 lines with no internal order is internal order, and it can be reconsidered afterwards from a better vantage point.
- Renaming `bit-lite-compiler` or folding it into `bit-lite-vendors`. Symmetry can be reached by adding the missing package or by removing the two that exist, and adding is the smaller, reversible move that also solves a real duplication.
- Changing what `typescript` is to `bit-lite-preview`. The node entry parses a demo file's syntax at runtime, so a parser is genuinely a runtime dependency; making it a peer would push a real requirement onto consumers for no benefit.
- Extending `typecheck` to cover test files. `tsconfig.json` excludes them from both build and typecheck, so a broken import in a test surfaces only when vitest runs it — a real gap, and a separate change with its own fallout.
- Touching `bit-lite-terminal`, `bit-lite-proxy`, or `bit-lite-deps`. Each depends on nothing it does not use and holds nothing it should not.

## Decisions

### 1. Four layers, named after what they know

```text
commands/    every command, the selection they share, the output two of them share
   ↑
execution/   plan vendor work per component or per env group; run it or watch it
   ↑
session/     what a resident command must release, and the shape of a contribution
   ↑
cli/         the declaration table, the parser, help rendering, the option readers
```

The order is the one the code already had; naming it is the whole change. `cli/` is the strongest claim: it knows what can be typed and nothing else, so it may not import a workspace, env, vendor, or history package. That is asserted, not just written here.

`bin.ts`, `cli.ts`, and `index.ts` stay directly in `src/`, above all four — `cli.ts` parses through `cli/` and dispatches into `commands/`.

`declarations.ts` and `help-text.ts` move from `commands/` into `cli/`. Neither was ever a command; `declarations.ts` imports nothing at all, and its consumers are the parser, help rendering, and dispatch.

### 2. The cycle breaks by moving two things, not by adding one

`assertNoSwallowedComponents` completes a judgement `parseArgs` deferred: the parser records in `consumedBareWords` that an undeclared option took a bare word, because it cannot know whether that word was a vendor's option value or a component. Only a caller holding a workspace can decide. That is the parser's own rule finished later, so it belongs in `args.ts` — which is also the last value-level edge in the cycle.

Moving it there raised a second question, and answering it improved the result: the function reads `workspace.components.map(c => c.id)` and nothing else, so it takes that shape rather than a whole `Workspace`. `cli/` then depends on the workspace model not at all, which is the claim the layer rule now asserts.

`prepare-workspace.ts` merges into `commands/selection.ts`, its only consumer. It reads a workspace, links the component packages, compiles the local envs, and resolves — and linking and compiling are the `link` and `compile` commands' own capabilities. It was therefore always a composition of commands, never a layer beneath them, which is why placing it below produced a cycle. Twenty lines with one caller are clearer inside that caller, and `commands/` is where a module that composes commands belongs.

That leaves `commands/selection.ts → commands/compile.ts` as a same-layer edge, which is what `start` composing `preview` already is: the README describes commands exposing reusable contributions on purpose.

### 3. Planning states the shape it reads

`createEnvServiceExecutionPlan` took a `ResolvedCommandSelection` and read one field of it. Typing the parameter as the env groups it actually reads removes the execution layer's only reference to the command layer, and follows what `selectCompileRootIds` already does with `Pick<ResolvedCommandSelection, "groups">`.

### 4. Add the missing contract package rather than remove the existing ones

The test result shape existed three times: `demo-vendors/src/testers/result.ts` (produced), `demo-vendors/src/samples/test-result.ts` (produced by the fixtures, spelled out inline), and `bit-lite/src/commands/test.ts` (validated). `bit-lite-tester` mirrors `bit-lite-compiler` exactly — same manifest shape, same two dependencies, same kind of contents — so the three services now differ only in what their contracts say.

It carries `TesterVendorRuntime` because both reference testers were spelling out `VendorRuntime<JsonObject, TestServiceResult>`, and does not carry a vendor-module guard, because nothing validates a tester module at a boundary. A guard with no call site would be a contract nobody had agreed to.

### 5. The manifest rule is checked in both directions

Forwards: a workspace package in `dependencies` must appear in an importing position in the package's production sources. Backwards: a workspace package reached from any source, test files included, must be declared somewhere. The first catches a boundary opened and forgotten; the second is what makes removing a declaration safe, since under pnpm an undeclared package resolves only by an accident of hoisting.

Two details decide whether the rule is usable. The specifier must sit after `from`, `import`, `require`, or a module mock, so a package named as data — as `package-boundaries.test.ts` and `history-independence.test.ts` both do — is not counted as a dependency. And the match must consume the closing delimiter, or `bit-lite-env` matches every mention of `bit-lite-env-resolution`; that is exactly the pair whose stale declarations went unnoticed.

The rule applies to packages with TypeScript sources. `demo-env-*` and the demo workspace declare packages they reach through env JSON specifiers and package resolution, which an import-based rule has nothing to say about.

### 6. React is an optional peer, `typescript` is not

`bit-lite-preview/browser` creates the root that an env's compositions mount into. Two React instances would break hooks, so the runtime must use the React of the workspace it is bundled for — which is what a peer dependency states and an ordinary dependency does not. `demo-config` already declares it this way.

Optional, because the split between the entries is real: `bit-lite-preview/node` prepares previews without React, and `bit-lite` — the only consumer of that entry — never renders anything.

## Risks / Trade-offs

- **The diff is large and almost entirely mechanical.** 90 files, of which most change only an import specifier. The mitigation is that behavior is fixed: every existing test passes unmodified, and the two tests that changed did so because the thing they described moved to a package where it can be tested by behavior instead of by reading source.
- **`src/cli.ts` now sits beside `src/cli/`.** Resolution is unambiguous and every import says which it means, but a reader meeting the tree for the first time may look twice. The alternative — a longer directory name, or moving the dispatcher into the layer it dispatches out of — is worse in a way that lasts.
- **`commands/` grew by two files.** It now holds nineteen modules, four of which are not commands. That is the honest arrangement rather than a tidier one: `install-reporter.ts` and `test-routes.ts` were already there for the same reason.
- **Two structural tests read source text.** Both could be fooled by a sufficiently strange spelling of an import. They are cheap, total, and catch the mistakes that actually happen, which is the same bargain `history-independence.test.ts` already makes.

## Migration Plan

Ordered so each step is verifiable and the earlier ones guard the later ones:

1. The manifest rule first, so every subsequent cross-package move is checked as it lands.
2. `bit-lite-tester`, which is additive and touches only the test contract.
3. The two cross-package moves, which shrink what the restructure has to consider.
4. The `utils` split and the cycle, the one large mechanical step.
5. The preview peer dependency and `bit-lite-context/src/utils`, independent of everything above.

`pnpm build`, `pnpm typecheck`, and every package's tests run after each step, compared against a baseline recorded before the first.

## Open Questions

- Should `typecheck` cover test files? It does not today, which is why a stale import in a test survived a clean typecheck during this work and was caught only by running the suite. Worth its own change.
- Why does `commands/test.test.ts` kill its own pool worker? After the third test — the one that starts worker-backed watch tasks — the worker exits and the remaining tests are reported as pending. That predates this change and holds on `main`, so four tests in the CLI's largest command suite have not been running. Moving the contract test into `bit-lite-tester` revived one of them by accident; the other three need the worker lifecycle understood, which is its own change.
- Is `packages/bit-lite` still too large once it has internal order? At 6,018 lines it is more than a third of the workspace, and `commands/tag.ts` alone is 575. The question is better asked after this lands than before.

## 1. Increment as a parameter of the derivation

- [ ] 1.1 Give `deriveNextComponentVersion` in `bit-lite-history/src/tags.ts` an increment parameter accepting patch, minor, or major, defaulting to patch so every existing caller keeps its result unchanged
- [ ] 1.2 Derive a component's first version by applying the requested increment to `0.0.0`, so it is `0.0.1` for patch, `0.1.0` for minor, and `1.0.0` for major
- [ ] 1.3 Add unit tests covering each increment from an existing version, each increment as a first version, and the existing patch-default behaviour of a caller that passes nothing
- [ ] 1.4 Confirm the full suite still passes, since this step is meant to change no behaviour

## 2. The version decision and the policy that reads it

- [ ] 2.1 Define the version decision type: an increment, an explicit version, include, or exclude, keyed by component id
- [ ] 2.2 Validate an explicit decision through `assertComponentVersion` so the three-number rule and the reserved `0.0.0-g` namespace apply without a second code path
- [ ] 2.3 Extend the tag policy in `tag.ts` to consult the decision map, falling back to the existing derivation for any component the map does not mention
- [ ] 2.4 Make a decision override the skip the way an explicit `--version` already does at `tag.ts:152`, and make an exclusion leave the component at the version it carries
- [ ] 2.5 Add tests constructing the decision map directly — no terminal — covering mixed increments across components, an explicit version, an override of a skip, an exclusion, and that an increment chosen for one component does not reach its dependents

## 3. Plan and execute phases

- [ ] 3.1 Split `runTagCommand` so computing the plan is separable from carrying it out, expressing today's behaviour as "plan, then execute with an empty decision map"
- [ ] 3.2 Express `--dry-run` as the plan phase alone, replacing the current `if (!dryRun)` guard around publication
- [ ] 3.3 Give the plan a row per component carrying its identifier, current version, proposed version, whether it would be skipped, and the reason it is in the release
- [ ] 3.4 Derive the reason from the change-source vocabulary the `component-history-inspection` capability already computes, rather than a second classification, and name the prerequisite responsible when a component is present only because one moved
- [ ] 3.5 Add a test asserting a plan-only run leaves every ref and anchor unchanged
- [ ] 3.6 Add a test asserting the existing non-interactive output and JSON shape are unchanged by the split

## 4. Shape recomputation

- [ ] 4.1 Recompute the plan from a decision map so an inclusion draws in every component that transitively depends on the included one, by re-running the plan phase rather than predicting on the dependency graph
- [ ] 4.2 Assert at execution that the release being carried out matches the release that was approved, failing without writing when it does not
- [ ] 4.3 Add tests covering an inclusion whose dependents cascade, an inclusion of a component nothing depends on, an exclusion, and that changing only an increment leaves membership identical
- [ ] 4.4 Add a test asserting a mismatch between approved and computed release aborts before any ref moves

## 5. The selection interface

- [ ] 5.1 Promote `bit-lite-terminal` from devDependency to dependency of `bit-lite`, and import it only on the interactive path
- [ ] 5.2 Build the selection screen on the package's raw-mode input, keypress decoding, render scheduling, and resize binding, taking injectable `stdin`/`stdout` as `vendor-task.ts` does; do not reuse `ManagedTerminal`, whose attach-and-detach model does not fit a table of editable rows
- [ ] 5.3 Render one row per component with identifier, current version, proposed version, and reason, marking skipped components distinctly
- [ ] 5.4 Implement moving between rows, cycling a row's increment, including and excluding a row, entering an explicit version, confirming, and cancelling
- [ ] 5.5 Report a rejected explicit version in place, keeping the review open rather than abandoning the release
- [ ] 5.6 Keep the row under edit visible when the release exceeds the viewport, indicate that further rows exist, and re-render on resize without losing any decision
- [ ] 5.7 Restore the terminal on every exit path, including cancellation and interruption
- [ ] 5.8 Add tests driving the interface through injected streams: navigation, each edit, an invalid explicit version, cancellation, and a resize mid-review

## 6. Command wiring

- [ ] 6.1 Add `--interactive` to `tag`, reading it through `readFlagOption` so its diagnostics match the other flags
- [ ] 6.2 Refuse `--interactive` with `--json`, and with `--version`, naming both options and failing before any component is prepared
- [ ] 6.3 Compose `--interactive` with `--dry-run` as plan, edit, report, and stop
- [ ] 6.4 Require an interactive terminal on both input and output, failing with a diagnostic that names the condition and states that omitting the option derives a patch increment for every component
- [ ] 6.5 Decide and implement what an empty release does under `--interactive`, per the open question in the design
- [ ] 6.6 Update the CLI help text for `tag` in `cli.ts`
- [ ] 6.7 Add tests for each refusal, for the non-TTY failure, and for `--interactive --dry-run`

## 7. Verification

- [ ] 7.1 Verify on the demo workspace end to end: a release covering several components with mixed increments, including a skipped component and watching its dependents appear, and cancelling to confirm nothing was written
- [ ] 7.2 Confirm `tag` without `--interactive` is byte-for-byte unchanged in behaviour and output
- [ ] 7.3 Run the full suite, build, and typecheck clean
- [ ] 7.4 Update `openspec/specs` expectations by validating the change with `--strict`

## Why

`tag` derives a patch increment for every component, because patch is the only increment that can be chosen without knowing what changed. Choosing minor or major is a statement of intent, and intent belongs to the user.

A release usually covers the whole workspace, and the right increment differs per component: one component broke its API, another only picked up a dependency's new version, a third is being promoted to `1.0.0`. No single directive describes that. Today the only escape is `--version`, which applies to exactly one component, so a multi-component release with mixed increments cannot be expressed at all — the user must either accept patch everywhere or tag components one command at a time, which is precisely the bottom-up sequencing that multi-component tagging exists to remove.

## What Changes

- `tag` gains an `--interactive` option that presents the release as a whole and lets the user decide each component's version before anything is written.
- Each listed component can be given a patch, minor, or major increment, or an explicit version. A component the derivation would skip can be pulled into the release, and a component it would tag can be excluded.
- The presented plan names why each component is in the release — its own source changed, a dependency moved, its env moved, or it has never been released — reusing the change-source vocabulary the `component-history-inspection` capability already defines.
- Pulling a skipped component into the release makes its dependents part of the release too, and the picker shows that consequence as it happens rather than after the fact.
- The decision point moves out of the middle of the recording traversal: the plan is computed, then edited, then executed. Cancelling writes nothing.
- Without a terminal, `--interactive` fails with a diagnostic rather than hanging or silently falling back to patch.
- **Not** in scope: a non-interactive `--bump` flag. Expressing per-component increments as flags (`--bump lib/math=major --bump ui/button=patch …`) is harder to use than the picker for the case that motivates the feature, so it would be paid for and not used. The existing no-flag default — patch for every component — remains the scriptable path, and `--version` keeps its current single-component meaning.

## Capabilities

### New Capabilities

- `interactive-version-selection`: presenting a pending release for review, editing each component's version decision, showing the consequences of those edits, and turning the result into the versions a recording operation assigns. Covers terminal and non-terminal behaviour, cancellation, and the guarantee that reviewing writes nothing.

### Modified Capabilities

- `component-version-tags`: `tag` accepts `--interactive` alongside its existing options; a version supplied by interactive selection overrides the skip rule the same way an explicit `--version` already does; and the per-component derivation accepts a caller-supplied increment instead of always incrementing the patch.

## Impact

- `packages/bit-lite/src/commands/tag.ts` — option parsing, and the tag policy that currently decides each component's version inline.
- `packages/bit-lite/src/utils/component-recording.ts` — `prepareRecording` currently interleaves preparation and version assignment; the plan/edit/execute split needs the decision to be available before the traversal that uses it.
- `packages/bit-lite-history/src/tags.ts` — `deriveNextComponentVersion` hard-codes the patch increment.
- `packages/bit-lite-terminal` — an existing internal package providing raw-mode input, keypress handling, render scheduling, and resize binding, already used in production by `bit-lite-vendors`. It is currently a devDependency of `bit-lite` and would become a dependency.
- No change to the store format, to recorded metadata, or to any existing command's default behaviour.

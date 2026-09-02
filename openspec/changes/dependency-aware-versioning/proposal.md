## Why

`bit-lite snap` currently captures a component's files exactly as they sit on disk, which means the recorded `.comp.json` still says `workspace:*` for every dependency on another workspace component. A snap therefore records *that* a component depended on a sibling, but never *which version* of it, and it records nothing at all about the env that decides how the component compiles and tests. Two snaps of the same component with different siblings underneath are indistinguishable, so a recorded version cannot be reproduced, compared, or reasoned about later.

Snaps are also produced in arbitrary order and in whatever selection `--filter` names, so even if versions were written down there would be no guarantee that a dependency's version was known by the time its dependent was recorded.

## What Changes

- Treat `workspace:*` as what it already is in practice — a placeholder meaning "this dependency is a component in this workspace right now" — and resolve it to a real version at the moment of recording, never on disk.
- Introduce a **projection**: the `.comp.json` written into a component commit is derived from the workspace, not copied from disk. It resolves `workspace:*` dependency versions and injects the component's resolved `env` reference. **BREAKING** for the recorded snapshot format: the committed `.comp.json` no longer matches the file on disk byte for byte.
- Add a `version` field to each component's entry in `bit-lite.json`, anchoring which version the component is currently based on. It sits beside the `env` reference it belongs with, it is the only workspace file a recording command writes back, and it is never captured by a snap because it lives outside every component root.
- Define the snap version format as `0.0.0-g<full git object id>` (for example `0.0.0-g9f2c3ab…`), borrowing `git describe`'s `g` prefix. These versions are **identifiers, not ordered versions** — semantic-version precedence over their prerelease text has no relationship to history order.
- Run `snap` and `tag` in component dependency order, using both component dependency edges and env edges, so every dependency's version is settled before any dependent is recorded.
- Make `--filter` strict: if a selected component depends on a workspace component that has never been snapped, or whose working content differs from its recorded head, the command fails and names the offending dependency instead of silently recording a combination that was never built or tested.
- Generalize `tag` from "never creates a snap" to "creates a snap only when the projection changes the component's content". A leaf component's tag still names its existing snap; a dependent whose dependency versions move from snap identifiers to semantic versions gets a new commit before being tagged.
- Reserve the `0.0.0-g<hex>` shape so a user cannot manually assign a version that collides with a generated snap identifier.
- Promote the correct component prerequisite definition (dependency edges plus env edges) into `bit-lite-context` as the single ordering used by compile, snap, and tag, replacing a misleading exported ordering that omits env edges and has no production caller.
- Write real version numbers into generated package manifests instead of `workspace:*`, falling back to `0.0.0` for a component that has never been snapped.

## Capabilities

### New Capabilities

- `component-version-resolution`: Defines the snap version format and its identifier-not-ordering semantics, the projection that turns workspace state into committed component content, the `version` anchor in workspace configuration and when it is written back, dependency-ordered execution of recording commands, the strictness rules that reject unresolvable dependencies, and the versions carried by generated package manifests.

### Modified Capabilities

- `component-snapshot-history`: The captured content for `.comp.json` becomes a projection of workspace state rather than the bytes on disk; the v1 snapshot boundary changes to record the component's env reference and resolved dependency versions; selected components are prepared in dependency order rather than selection order.
- `component-version-tags`: Tagging may create a snap when the projection changes a component's content, and the `0.0.0-g<hex>` namespace is refused for user-supplied versions.

## Impact

- `packages/bit-lite-history`: `snapComponents` splits into an explicitly exposed prepare phase and publish phase, and snapshot/object creation gains a way to substitute the bytes of a single captured file. The two-phase guarantee (prepare everything, then one atomic ref transaction) is preserved.
- `packages/bit-lite/src/commands/snap.ts` and `tag.ts`: own the workspace dependency graph, drive the topological loop, call the pure projection function, enforce `--filter` strictness, and write the `version` anchors back to `bit-lite.json` in one file update only after the ref transaction succeeds.
- `packages/bit-lite-context`: gains the shared component prerequisite/ordering definition, reads and writes the new per-component `version` field in `bit-lite.json`, and closes the registration hole that lets a component root coincide with the workspace root; the `workspace:*` detection that drives internal dependency and env resolution is unchanged, because the placeholder stays on disk.
- `.comp.json` is unchanged on disk and stays authored; only its committed projection differs from it.
- `packages/bit-lite/src/commands/compile.ts`: uses the promoted shared ordering instead of its private prerequisite helper.
- `packages/bit-lite/src/commands/link.ts`: generated manifests carry component versions read from disk; `link` still never touches the history store.
- `packages/demo-workspace`: `bit-lite.json` component entries gain a `version` anchor once snapped.
- Adds unit tests for the pure projection and version formatting, and integration tests over real bare repositories for dependency-ordered snapping, tag-induced snaps, and the strictness failures.

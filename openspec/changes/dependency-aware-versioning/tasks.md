## 1. Shared component ordering

- [x] 1.1 Add a shared component prerequisite definition to `bit-lite-context` covering workspace dependency edges and the local env edge, matching the current `compilePrerequisitePackageNames` behavior
- [x] 1.2 Add a dependency-ordering helper over that definition that returns layered or topologically sorted components and reports cycles with the offending path
- [x] 1.3 Move `compile.ts` onto the shared definition and delete its private `compilePrerequisitePackageNames` helper
- [x] 1.4 Correct or remove the exported `orderWorkspaceComponents`, which omits env edges and has no production caller, and update `bit-lite-context`'s exports and any re-export in `link.ts`
- [x] 1.5 Add unit tests for ordering across dependency edges, env edges, mixed graphs, and cycle detection
- [x] 1.6 Verify existing compile tests still pass with no behavior change

## 2. Version anchor in workspace configuration

- [x] 2.1 Read an optional `version` field on each `bit-lite.json` component entry in `loadConfig`/`readWorkspace` and expose it on `WorkspaceComponent` beside the env reference; absent means the component has never been recorded
- [x] 2.2 Validate the field as a non-empty string and reject malformed values with the existing `bit-lite.json` diagnostic style
- [x] 2.3 Add writing version anchors back to `bit-lite.json` as one file update that preserves entry order and formatting and leaves every other entry untouched
- [x] 2.4 Reject registering a component whose path resolves to the workspace root, so `bit-lite.json` can never fall inside a captured component tree
- [x] 2.5 Confirm `workspace:*` detection for internal dependencies and envs is untouched, and add a regression test asserting the placeholder still drives internal dependency and env resolution
- [x] 2.6 Add unit tests for present, absent, and malformed `version` fields, for anchor write-back preserving unrelated content, and for the workspace-root registration rejection

## 3. History layer: content substitution and explicit phases

- [x] 3.1 Extend the snapshot file entry model so one captured file can supply bytes directly instead of being read from disk
- [x] 3.2 Extend blob and tree creation to write a substituted file's bytes, keeping the batched hashing path for all other files
- [x] 3.3 Split `snapComponents` into an exported prepare phase and publish phase, keeping `snapComponents` working as a caller of both so existing behavior and tests are unchanged
- [x] 3.4 Accept a per-file content override on the prepare phase's input
- [x] 3.5 Add unit tests that a substituted file's bytes land in the tree while every other file is captured verbatim, and that preparation still writes no refs

## 4. Version format and projection

- [x] 4.1 Add snap version formatting and parsing for `0.0.0-g<full object id>`, plus a predicate for the reserved shape
- [x] 4.2 Document in code that snap versions are identifiers without ordering, and provide no comparison helper over them
- [x] 4.3 Implement `project()` as a pure function taking the working `.comp.json`, the component's `bit-lite.json` entry, and a resolved-version lookup, producing the committed bytes by resolving placeholder dependencies and injecting `env`
- [x] 4.4 Make `project()` record an external env's declared specifier without resolving any installed package
- [x] 4.5 Produce deterministic byte output from `project()` so an unchanged component yields an identical tree
- [x] 4.6 Add unit tests for version formatting, the reserved-shape predicate, and every projection case: placeholder dependency, local env, external env, and no dependencies

## 5. Dependency-ordered snap

- [x] 5.1 Drive `runSnapCommand` through the shared dependency ordering instead of selection order
- [x] 5.2 Resolve each component's placeholder dependency and env versions from versions settled earlier in the run, falling back to the store's canonical head refs, never from a version anchor
- [x] 5.3 Fail when a prerequisite outside the selection has never been recorded, naming both components and suggesting the corrected filter
- [x] 5.4 Fail when a prerequisite outside the selection has a recorded head but a differing candidate tree, naming both components and suggesting the corrected filter
- [x] 5.5 Resolve a prerequisite outside the selection to its head version when its candidate tree matches, without recording it again
- [x] 5.6 Prepare every component before publishing, keeping the single atomic ref transaction
- [x] 5.7 Write the recorded components' version anchors back to `bit-lite.json` in one update only after publication succeeds, and confirm no component-owned file is modified
- [x] 5.8 Add integration tests over a real bare store for: ordered recording of a dependency chain, an env recorded before its user, a dependent gaining a new version when only its dependency changed, unchanged detection across repeated snaps, both strictness failures leaving no ref and no workspace file modified, and cycle rejection

## 6. Version validation and derivation

- [x] 6.1 Restrict `assertComponentVersion` to exactly `major.minor.patch`, refusing prereleases, build metadata, `v` prefixes, and loose spellings
- [x] 6.2 Keep the snap identifier shape as a more specific diagnostic, so pasting one says it is a snap identifier rather than only that prereleases are refused
- [x] 6.3 Add listing a component's assigned versions to the history layer, peeling annotated tags and ignoring refs outside that component
- [x] 6.4 Add version derivation: increment the patch of a component's highest assigned version, or `0.0.1` when it has none
- [x] 6.5 Add unit tests for version validation, for derivation from none, one, and several existing versions, and for derivation ignoring another component's versions

## 7. Tag as a multi-component, dependency-ordered operation

- [x] 7.1 Select components in `tag` with the same conventions as other workspace commands, so no filter selects every registered component
- [x] 7.2 Drive `tag` through the shared recording path so each component is projected in dependency order and a changed projection produces a snap before annotation
- [x] 7.3 Make each component's tag point at its existing snap when the projection left the tree unchanged, preserving today's idempotent and immutable tag behavior
- [x] 7.4 Resolve a dependency tagged earlier in the same operation to its assigned semantic version rather than its snap identifier
- [x] 7.5 Accept `--version` only when the selection resolves to exactly one component, and fail naming the matched components otherwise
- [x] 7.6 Write the tagged components' version anchors back to `bit-lite.json` after the tag refs are published
- [x] 7.7 Update the CLI help for `tag`
- [x] 7.8 Add integration tests for: tagging a leaf creating no commit, tagging a dependency and dependent together so the dependent records the dependency's semantic version, deriving independent versions across components, `--version` with one and with several components, tagging every component without filters, and the existing immutability and idempotence scenarios

## 8. Shared command options

- [x] 8.1 Add `--dry-run` to `snap` and `tag`, reporting what would happen and changing no ref, tag, or anchor
- [x] 8.2 Add `--json` to `snap` and `tag`, emitting the structured result with unabbreviated version identifiers
- [x] 8.3 Add `--message` to `snap` and `tag`, replacing the generated commit or tag message and defaulting to today's deterministic text
- [x] 8.4 Confirm a supplied message never turns an unchanged component into a recorded one
- [x] 8.5 Update the CLI help for both commands
- [x] 8.6 Add tests for each option on both commands, including a dry run leaving refs, tags, and anchors untouched

## 9. Generated package manifests

- [x] 9.1 Write each local dependency's current version from its `bit-lite.json` anchor into `createGeneratedPackageManifest` instead of the workspace placeholder, falling back to `0.0.0`
- [x] 9.2 Write the component's own version into the generated manifest instead of the hard-coded `"0.0.0"`, falling back to `0.0.0`
- [x] 9.3 Confirm linking still reads only the workspace and never opens the component history store, and add a regression test
- [x] 9.4 Add unit tests for a recorded dependency, an unrecorded dependency, and a component with no recorded version

## 10. Fixtures, documentation, and verification

- [x] 10.1 Update demo workspace fixtures and any test fixtures that assert on `bit-lite.json` shape or on generated manifest versions
- [x] 10.2 Update CLI help and README where they describe what a snap captures and how component versions are spelled, including that snap versions are unordered identifiers
- [x] 10.3 Confirm `history-independence.test.ts` still passes, so non-versioning commands remain independent of the store
- [x] 10.4 Run the full build, typecheck, and test suites across the monorepo
- [x] 10.5 Exercise the demo workspace end to end: install, link, compile, snap in dependency order, tag, and confirm recorded metadata names resolved versions

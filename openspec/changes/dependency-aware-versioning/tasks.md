## 1. Shared component ordering

- [ ] 1.1 Add a shared component prerequisite definition to `bit-lite-context` covering workspace dependency edges and the local env edge, matching the current `compilePrerequisitePackageNames` behavior
- [ ] 1.2 Add a dependency-ordering helper over that definition that returns layered or topologically sorted components and reports cycles with the offending path
- [ ] 1.3 Move `compile.ts` onto the shared definition and delete its private `compilePrerequisitePackageNames` helper
- [ ] 1.4 Correct or remove the exported `orderWorkspaceComponents`, which omits env edges and has no production caller, and update `bit-lite-context`'s exports and any re-export in `link.ts`
- [ ] 1.5 Add unit tests for ordering across dependency edges, env edges, mixed graphs, and cycle detection
- [ ] 1.6 Verify existing compile tests still pass with no behavior change

## 2. Version anchor in workspace configuration

- [ ] 2.1 Read an optional `version` field on each `bit-lite.json` component entry in `loadConfig`/`readWorkspace` and expose it on `WorkspaceComponent` beside the env reference; absent means the component has never been recorded
- [ ] 2.2 Validate the field as a non-empty string and reject malformed values with the existing `bit-lite.json` diagnostic style
- [ ] 2.3 Add writing version anchors back to `bit-lite.json` as one file update that preserves entry order and formatting and leaves every other entry untouched
- [ ] 2.4 Reject registering a component whose path resolves to the workspace root, so `bit-lite.json` can never fall inside a captured component tree
- [ ] 2.5 Confirm `workspace:*` detection for internal dependencies and envs is untouched, and add a regression test asserting the placeholder still drives internal dependency and env resolution
- [ ] 2.6 Add unit tests for present, absent, and malformed `version` fields, for anchor write-back preserving unrelated content, and for the workspace-root registration rejection

## 3. History layer: content substitution and explicit phases

- [ ] 3.1 Extend the snapshot file entry model so one captured file can supply bytes directly instead of being read from disk
- [ ] 3.2 Extend blob and tree creation to write a substituted file's bytes, keeping the batched hashing path for all other files
- [ ] 3.3 Split `snapComponents` into an exported prepare phase and publish phase, keeping `snapComponents` working as a caller of both so existing behavior and tests are unchanged
- [ ] 3.4 Accept a per-file content override on the prepare phase's input
- [ ] 3.5 Add unit tests that a substituted file's bytes land in the tree while every other file is captured verbatim, and that preparation still writes no refs

## 4. Version format and projection

- [ ] 4.1 Add snap version formatting and parsing for `0.0.0-g<full object id>`, plus a predicate for the reserved shape
- [ ] 4.2 Document in code that snap versions are identifiers without ordering, and provide no comparison helper over them
- [ ] 4.3 Implement `project()` as a pure function taking the working `.comp.json`, the component's `bit-lite.json` entry, and a resolved-version lookup, producing the committed bytes by resolving placeholder dependencies and injecting `env`
- [ ] 4.4 Make `project()` record an external env's declared specifier without resolving any installed package
- [ ] 4.5 Produce deterministic byte output from `project()` so an unchanged component yields an identical tree
- [ ] 4.6 Add unit tests for version formatting, the reserved-shape predicate, and every projection case: placeholder dependency, local env, external env, and no dependencies

## 5. Dependency-ordered snap

- [ ] 5.1 Drive `runSnapCommand` through the shared dependency ordering instead of selection order
- [ ] 5.2 Resolve each component's placeholder dependency and env versions from versions settled earlier in the run, falling back to the store's canonical head refs, never from a version anchor
- [ ] 5.3 Fail when a prerequisite outside the selection has never been recorded, naming both components and suggesting the corrected filter
- [ ] 5.4 Fail when a prerequisite outside the selection has a recorded head but a differing candidate tree, naming both components and suggesting the corrected filter
- [ ] 5.5 Resolve a prerequisite outside the selection to its head version when its candidate tree matches, without recording it again
- [ ] 5.6 Prepare every component before publishing, keeping the single atomic ref transaction
- [ ] 5.7 Write the recorded components' version anchors back to `bit-lite.json` in one update only after publication succeeds, and confirm no component-owned file is modified
- [ ] 5.8 Add integration tests over a real bare store for: ordered recording of a dependency chain, an env recorded before its user, a dependent gaining a new version when only its dependency changed, unchanged detection across repeated snaps, both strictness failures leaving no ref and no workspace file modified, and cycle rejection

## 6. Tag as projection plus conditional snap

- [ ] 6.1 Project the component before tagging and compare the resulting tree against the current snap's tree
- [ ] 6.2 Tag the existing snap when the tree is unchanged, preserving today's idempotent and immutable tag behavior
- [ ] 6.3 Create a snap carrying the projected content as a child of the current snap when the tree changed, then annotate it
- [ ] 6.4 Reject a user-supplied version matching the reserved snap identifier shape in `assertComponentVersion`
- [ ] 6.5 Write the tagged component's version anchor back to `bit-lite.json` after the tag ref is published
- [ ] 6.6 Add integration tests for: tagging a leaf creating no commit, tagging a dependent whose dependency versions changed creating a commit, reserved-shape rejection, and unchanged existing tag immutability and idempotence scenarios

## 7. Generated package manifests

- [ ] 7.1 Write each local dependency's current version from its `bit-lite.json` anchor into `createGeneratedPackageManifest` instead of the workspace placeholder, falling back to `0.0.0`
- [ ] 7.2 Write the component's own version into the generated manifest instead of the hard-coded `"0.0.0"`, falling back to `0.0.0`
- [ ] 7.3 Confirm linking still reads only the workspace and never opens the component history store, and add a regression test
- [ ] 7.4 Add unit tests for a recorded dependency, an unrecorded dependency, and a component with no recorded version

## 8. Fixtures, documentation, and verification

- [ ] 8.1 Update demo workspace fixtures and any test fixtures that assert on `bit-lite.json` shape or on generated manifest versions
- [ ] 8.2 Update CLI help and README where they describe what a snap captures and how component versions are spelled, including that snap versions are unordered identifiers
- [ ] 8.3 Confirm `history-independence.test.ts` still passes, so non-versioning commands remain independent of the store
- [ ] 8.4 Run the full build, typecheck, and test suites across the monorepo
- [ ] 8.5 Exercise the demo workspace end to end: install, link, compile, snap in dependency order, tag, and confirm recorded metadata names resolved versions

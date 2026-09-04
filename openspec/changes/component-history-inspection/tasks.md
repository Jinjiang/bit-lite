## 1. Read-only tree computation

- [x] 1.1 Extract the snapshot and blob-hashing logic so the writing path and a compute-only path share everything up to the blob IDs
- [x] 1.2 Add compute-only blob hashing that produces the same IDs without `-w`
- [x] 1.3 Add a tree serializer that builds the nested subtree structure from the flat entry list and hashes each tree object's bytes, applying Git's entry ordering rule that sorts a directory as though its name ended in `/`
- [x] 1.4 Add a test asserting the writing path and the compute-only path produce identical tree IDs for the same component, covering nested directories, executable modes, and the substituted `.comp.json`; this is the only guard tying the serializer to Git's own, so treat a failure here as blocking
- [x] 1.5 Add a test asserting a compute-only run leaves the store's object count and refs unchanged

## 2. History reading primitives

- [x] 2.1 Add walking a component's linear history from its canonical head; `readComponentCommit` already returns commit ID, tree ID, and parents, so extend it with the authored timestamp rather than writing a second reader
- [x] 2.2 Reuse `listComponentVersionRefs` for per-snap tag lookup; it already peels annotated tags, so add only what decoration needs on top of it
- [x] 2.3 Add reading a component's recorded metadata from a snap by extracting and parsing the committed `.comp.json` blob
- [x] 2.4 Add tree-to-tree file comparison returning added, modified, and deleted component-relative paths
- [x] 2.5 Report a component with no canonical history as never recorded rather than failing, across all primitives
- [x] 2.6 Add unit tests for history walking, tag lookup, metadata reading, and file comparison over a real bare store

## 3. Comparison and attribution

- [ ] 3.1 Implement a shared comparison producing file changes plus metadata changes between two component states, where a state is working content or a recorded snap
- [ ] 3.2 Project working content before comparing so working and recorded states are always compared in the same form, resolving each workspace prerequisite to the version at its own canonical head and never refusing an unrecorded or modified prerequisite
- [ ] 3.3 Propagate modification over the prerequisite graph so a component whose prerequisite is modified is itself reported changed, naming the prerequisite responsible
- [ ] 3.4 Add a test asserting a component with untouched files is reported changed when its workspace dependency is modified, and that snapping both in one operation creates a commit for each
- [ ] 3.5 Exclude `.comp.json` from the file-change list and derive dependency and env changes from parsed metadata on both sides
- [ ] 3.6 Report metadata differences that are neither dependency nor env changes rather than dropping them
- [ ] 3.7 Implement change-source attribution classifying a snap against its parent as any combination of source, deps, and env, and marking a parentless snap as the initial version
- [ ] 3.8 Add unit tests for attribution covering source-only, deps-only, env-only, combined, initial version, and metadata reformatting that must not be reported as a version change

## 4. Status command

- [ ] 4.1 Add `status` reading the workspace with `readWorkspace` as `snap` does, so it stays independent of resolved envs and installed packages, selecting components with existing filter conventions, and opening the store without creating one
- [ ] 4.2 Report never-recorded components, including when the workspace has no store at all
- [ ] 4.3 Report modified components by comparing projected working content against the head tree, including components modified only because a prerequisite is
- [ ] 4.4 Report behind components by testing whether the version anchor names an ancestor of the head, resolving an anchor that holds either a snap version identifier or a semantic version naming a tag, and state that recording from that state would record content based on the older version
- [ ] 4.5 Report available dependency and env updates by comparing each dependency's current version against the version recorded in the component's head
- [ ] 4.6 Report never-released components: a head exists, nothing is modified, and no semantic version is assigned to that head
- [ ] 4.7 Report a component with no applicable condition as clean, and allow multiple conditions on one component
- [ ] 4.8 Report the head version, and both the anchored and head versions when they differ
- [ ] 4.9 Add a reporter producing one line per component plus a structured result for machine-readable output
- [ ] 4.10 Add integration tests over a real bare store for every state, for multiple simultaneous conditions, for a workspace with no store, and for a workspace with nothing installed
- [ ] 4.11 Add an integration test asserting `status` filtered to one component still reports when a prerequisite outside the selection is unrecorded or modified, where recording would refuse
- [ ] 4.12 Register `status` in the CLI and its help

## 5. Log command

- [ ] 5.1 Add `log` requiring a selection resolving to exactly one component and listing its history from the head backwards
- [ ] 5.2 Show each snap's version identifier abbreviated for display, its authored timestamp, and any semantic versions tagged on it
- [ ] 5.3 Show each snap's change source with the dependency and env versions on both sides where applicable
- [ ] 5.4 Report a component with no history as never recorded without failing
- [ ] 5.5 Add a structured output variant carrying unabbreviated version identifiers
- [ ] 5.6 Add integration tests for a multi-snap history, tag decoration, an env-only version, a deps-only version, and a component with no history
- [ ] 5.7 Register `log` in the CLI and its help

## 6. Diff command

- [ ] 6.1 Add `diff` requiring a selection resolving to exactly one component and defaulting to projected working content against the recorded head
- [ ] 6.2 Accept explicit states naming a snap version identifier or an assigned semantic version on either side, and fail naming the component and any version that does not resolve to one of its snaps
- [ ] 6.3 Present source file changes as added, modified, or deleted component-relative paths
- [ ] 6.4 Present dependency changes as added, removed, and changed entries with versions on each side, and env changes separately
- [ ] 6.5 Add a structured output variant carrying the same facts with unabbreviated version identifiers
- [ ] 6.6 Add an integration test asserting a default diff reports no changes exactly when snapping reports the component unchanged, including the case where only a dependency version moved and the case where a prerequisite has uncommitted changes
- [ ] 6.7 Add integration tests for working-versus-head, snap-versus-snap, tag-versus-tag, and unresolved version arguments
- [ ] 6.8 Register `diff` in the CLI and its help

## 7. Documentation and verification

- [ ] 7.1 Update the root README's implemented-capabilities and not-implemented sections to reflect that history inspection now exists, and add the three commands to its CLI overview table
- [ ] 7.2 Document the three commands in `packages/bit-lite/README.md`, and while there correct that page's stale `snap` and `tag` sections, which still describe `tag` as single-component and describe `snap` capturing `.comp.json` without mentioning the projection
- [ ] 7.3 Document that a component can gain a version with no source change and that the change source explains it
- [ ] 7.4 Confirm non-versioning commands remain independent of the store, that inspection commands never create one, and that inspection needs no install
- [ ] 7.5 Run the full build, typecheck, and test suites across the monorepo
- [ ] 7.6 Exercise the demo workspace end to end: snap, tag, upgrade an env, re-snap, then verify status, log attribution, and diff all explain the resulting versions

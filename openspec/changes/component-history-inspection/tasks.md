## 1. Read-only tree computation

- [ ] 1.1 Extract the snapshot entry-building and tree-assembly logic so the writing path and a compute-only path share it
- [ ] 1.2 Add a compute-only tree path that hashes blobs without persisting them and derives the tree ID without a durable index
- [ ] 1.3 Add a test asserting the writing path and the compute-only path produce identical tree IDs for the same component, including executable modes and substituted metadata
- [ ] 1.4 Add a test asserting a compute-only run leaves the store's object count and refs unchanged

## 2. History reading primitives

- [ ] 2.1 Add walking a component's linear history from its canonical head, returning commit ID, tree ID, parent, and authored timestamp
- [ ] 2.2 Add listing the component version tags pointing at each snap of a component, peeling annotated tags
- [ ] 2.3 Add reading a component's recorded metadata from a snap by extracting and parsing the committed `.comp.json` blob
- [ ] 2.4 Add tree-to-tree file comparison returning added, modified, and deleted component-relative paths
- [ ] 2.5 Report a component with no canonical history as never recorded rather than failing, across all primitives
- [ ] 2.6 Add unit tests for history walking, tag lookup, metadata reading, and file comparison over a real bare store

## 3. Comparison and attribution

- [ ] 3.1 Implement a shared comparison producing file changes plus metadata changes between two component states, where a state is working content or a recorded snap
- [ ] 3.2 Project working content before comparing so working and recorded states are always compared in the same form
- [ ] 3.3 Exclude `.comp.json` from the file-change list and derive dependency and env changes from parsed metadata on both sides
- [ ] 3.4 Report metadata differences that are neither dependency nor env changes rather than dropping them
- [ ] 3.5 Implement change-source attribution classifying a snap against its parent as any combination of source, deps, and env, and marking a parentless snap as the initial version
- [ ] 3.6 Add unit tests for attribution covering source-only, deps-only, env-only, combined, initial version, and metadata reformatting that must not be reported as a version change

## 4. Status command

- [ ] 4.1 Add `status` resolving the workspace, selecting components with existing filter conventions, and opening the store without creating one
- [ ] 4.2 Report never-recorded components, including when the workspace has no store at all
- [ ] 4.3 Report modified components by comparing projected working content against the head tree
- [ ] 4.4 Report behind components by testing whether the working version anchor names an ancestor of the head, and state that recording from that state would record content based on the older version
- [ ] 4.5 Report available dependency and env updates by comparing each dependency's current version against the version recorded in the component's head
- [ ] 4.6 Report a component with no applicable condition as clean, and allow multiple conditions on one component
- [ ] 4.7 Add a reporter producing one line per component plus a structured result for machine-readable output
- [ ] 4.8 Add integration tests over a real bare store for every state, for multiple simultaneous conditions, and for a workspace with no store
- [ ] 4.9 Register `status` in the CLI and its help

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
- [ ] 6.6 Add an integration test asserting a default diff reports no changes exactly when snapping reports the component unchanged, including the case where only a dependency version moved
- [ ] 6.7 Add integration tests for working-versus-head, snap-versus-snap, tag-versus-tag, and unresolved version arguments
- [ ] 6.8 Register `diff` in the CLI and its help

## 7. Documentation and verification

- [ ] 7.1 Update README's implemented-capabilities and not-implemented sections to reflect that history inspection now exists
- [ ] 7.2 Document that a component can gain a version with no source change and that the change source explains it
- [ ] 7.3 Confirm non-versioning commands remain independent of the store, and that inspection commands never create one
- [ ] 7.4 Run the full build, typecheck, and test suites across the monorepo
- [ ] 7.5 Exercise the demo workspace end to end: snap, tag, upgrade an env, re-snap, then verify status, log attribution, and diff all explain the resulting versions

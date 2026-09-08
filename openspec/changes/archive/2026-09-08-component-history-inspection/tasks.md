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

- [x] 3.1 Implement a shared comparison producing file changes plus metadata changes between two component states, where a state is working content or a recorded snap
- [x] 3.2 Project working content before comparing so working and recorded states are always compared in the same form, resolving each workspace prerequisite to the version at its own canonical head and never refusing an unrecorded or modified prerequisite
- [x] 3.3 Propagate modification over the prerequisite graph so a component whose prerequisite is modified is itself reported changed, naming the prerequisite responsible
- [x] 3.4 Add a test asserting a component with untouched files is reported changed when its workspace dependency is modified, and that snapping both in one operation creates a commit for each
- [x] 3.5 Exclude `.comp.json` from the file-change list and derive dependency and env changes from parsed metadata on both sides
- [x] 3.6 Report metadata differences that are neither dependency nor env changes rather than dropping them
- [x] 3.7 Implement change-source attribution classifying a snap against its parent as any combination of source, deps, and env, and marking a parentless snap as the initial version
- [x] 3.8 Add unit tests for attribution covering source-only, deps-only, env-only, combined, initial version, and metadata reformatting that must not be reported as a version change

## 4. Status command

- [x] 4.1 Add `status` reading the workspace with `readWorkspace` as `snap` does, so it stays independent of resolved envs and installed packages, selecting components with existing filter conventions, and opening the store without creating one
- [x] 4.2 Report never-recorded components, including when the workspace has no store at all
- [x] 4.3 Report modified components by comparing projected working content against the head tree, including components modified only because a prerequisite is
- [x] 4.4 Report behind components by testing whether the version anchor names an ancestor of the head, resolving an anchor that holds either a snap version identifier or a semantic version naming a tag, and state that recording from that state would record content based on the older version
- [x] 4.5 Report available dependency and env updates by comparing each dependency's current version against the version recorded in the component's head
- [x] 4.6 Report never-released components: a head exists, nothing is modified, and no semantic version is assigned to that head
- [x] 4.7 Report a component with no applicable condition as clean, and allow multiple conditions on one component
- [x] 4.8 Report the head version, and both the anchored and head versions when they differ
- [x] 4.9 Add a reporter producing one line per component plus a structured result for machine-readable output
- [x] 4.10 Add integration tests over a real bare store for every state, for multiple simultaneous conditions, for a workspace with no store, and for a workspace with nothing installed
- [x] 4.11 Add an integration test asserting `status` filtered to one component still reports when a prerequisite outside the selection is unrecorded or modified, where recording would refuse
- [x] 4.12 Register `status` in the CLI and its help
- [x] 4.13 Add `--detail`, expanding each modified component into its differing component-owned files as added, modified, or deleted paths, plus the dependency, env, and other metadata changes behind the difference; reuse the shared comparison rather than adding a second reading path
- [x] 4.14 Restrict `--detail` to comparing projected working content against the recorded head, and do not accept version arguments; comparing recorded versions against each other is what `log` reports
- [x] 4.15 Leave a component that is not modified without an expansion, and keep a component modified only by a prerequisite showing the prerequisite rather than files of its own
- [x] 4.16 Carry the expansion in the structured output with unabbreviated version identifiers
- [x] 4.17 Add integration tests asserting `--detail` reports the same components and conditions as the summary view, expands a modified component into files and metadata changes, and expands a prerequisite-only modification into no files of its own

## 5. Log command

- [x] 5.1 Add `log` requiring a selection resolving to exactly one component and listing its history from the head backwards
- [x] 5.2 Show each snap's version identifier abbreviated for display, its authored timestamp, and any semantic versions tagged on it
- [x] 5.3 Show each snap's change source with the dependency and env versions on both sides where applicable
- [x] 5.4 Report a component with no history as never recorded without failing
- [x] 5.5 Add a structured output variant carrying unabbreviated version identifiers
- [x] 5.6 Add integration tests for a multi-snap history, tag decoration, an env-only version, a deps-only version, and a component with no history
- [x] 5.7 Register `log` in the CLI and its help

## 6. Diff command

`diff` becomes a unified-diff patch. Tasks 6.3, 6.4, and 6.6 built the semantic comparison report, which moves to `status --detail` in section 4 above; their work is reused there rather than repeated, and is removed from `diff`.

- [x] 6.1 Add `diff` defaulting to projected working content against the recorded head
- [x] 6.2 Accept explicit states naming a snap version identifier or an assigned semantic version on either side, and fail naming the component and any version that does not resolve to one of its snaps
- [x] 6.8 Register `diff` in the CLI and its help
- [x] 6.9 Follow `status`' selection conventions instead of requiring one component, and require a selection resolving to exactly one component only when two recorded versions are named, failing with the matched components otherwise
- [x] 6.10 Add reading a blob's bytes by object ID to the history layer for the recorded side, and read the working side from the component root, since the tree it belongs to is computed and never written
- [x] 6.11 Add line comparison over the two sides producing hunks with three lines of context, treating content that is not valid UTF-8 as binary rather than rendering it
- [x] 6.12 Serialize hunks as a unified diff with `diff --git`, `index`, `---`, `+++`, and `@@` headers, emitting the real blob IDs on the `index` line, `/dev/null` and the file mode for an added or deleted file, and a mode change with no hunk when only the mode differs
- [x] 6.13 Address paths as `a/<component-id>::<path>` and `b/<component-id>::<path>`, and add a test asserting two components owning a file of the same name appear on distinct paths
- [x] 6.14 Precede each component's patches with a banner naming the component and both states, and add a test asserting no banner line begins with a character unified diff gives meaning to
- [x] 6.15 Remove the semantic report from `diff`: source file status lines, dependency and env sections, and the prerequisite advisory section
- [x] 6.16 Include `.comp.json` as an ordinary file patch
- [x] 6.17 Write the patch and nothing else to standard output, sending any advisory to standard error, and add a test asserting redirected output is a valid patch
- [x] 6.18 Emit an empty patch and succeed when nothing differs, and when a component is modified only because a prerequisite is, write an advisory naming the prerequisite to standard error
- [x] 6.19 Replace the structured output variant so it carries the patch alongside the per-file entries, with unabbreviated version identifiers
- [x] 6.20 Add unit tests over the serialized bytes for a modified file, an added file, a deleted file, a mode-only change, a binary file, and an empty patch
- [x] 6.21 Add integration tests for working-versus-head, snap-versus-snap, tag-versus-tag, unresolved version arguments, two versions with an ambiguous selection, and a multi-component patch ordered by component identifier

## 7. Documentation and verification

- [x] 7.1 Update the root README's implemented-capabilities and not-implemented sections to reflect that history inspection now exists, and add the three commands to its CLI overview table
- [x] 7.2 Document the three commands in `packages/bit-lite/README.md`, and while there correct that page's stale `snap` and `tag` sections, which still describe `tag` as single-component and describe `snap` capturing `.comp.json` without mentioning the projection
- [x] 7.3 Document that a component can gain a version with no source change and that the change source explains it
- [x] 7.4 Confirm non-versioning commands remain independent of the store, that inspection commands never create one, and that inspection needs no install
- [x] 7.5 Run the full build, typecheck, and test suites across the monorepo
- [x] 7.6 Exercise the demo workspace end to end: snap, tag, upgrade an env, re-snap, then verify status, log attribution, and diff all explain the resulting versions
- [x] 7.7 Update both READMEs for the revised division of labor: `status --detail` carries the semantic account of what recording would capture, and `diff` emits a patch
- [x] 7.8 Document the patch format — the component-qualified paths, the banner, and that the paths are not applicable to a checkout — and state that an empty patch does not mean recording will do nothing, pointing at `status` for that
- [x] 7.9 Re-run the full build, typecheck, and test suites across the monorepo
- [x] 7.10 Re-exercise the demo workspace end to end, additionally redirecting a multi-component diff to a `*.diff` file and confirming it opens as a patch, that each component is separated by its banner, and that two components owning a file of the same name stay distinct

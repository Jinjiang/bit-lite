## Purpose

Define the read-only commands that report a component's state against its recorded history — `status`, `log`, and `diff` — together with the guarantees that keep what they report consistent with what recording would do.

## Requirements

### Requirement: Inspection never mutates the component history store

Every inspection command SHALL leave the component history store byte-identical. Computing a component's candidate tree for comparison SHALL NOT write blobs, trees, commits, or refs, and SHALL NOT create durable index state.

A candidate tree computed for inspection SHALL have the same object ID the recording path would produce for the same component content, so inspection and recording can never disagree about whether a component changed.

#### Scenario: Inspect a workspace repeatedly

- **WHEN** a user runs inspection commands against a workspace any number of times
- **THEN** the component history store contains no new objects and no changed refs

#### Scenario: Inspection and recording agree on content identity

- **WHEN** the same component content is measured by an inspection command and by a recording command
- **THEN** both produce the same tree object ID

#### Scenario: Inspect a workspace with no store

- **WHEN** an inspection command runs in a workspace that has no component history store
- **THEN** it reports every selected component as never recorded
- **AND** does not create a store

### Requirement: Report component state against recorded history

Bit Lite SHALL provide a `status` command reporting, for each selected component, its recorded version and every one of the following conditions that applies:

- **never recorded**: the component has no canonical history;
- **modified**: the component's projected working content differs from its recorded head, or any of its workspace prerequisites is modified;
- **never released**: the component has a canonical head and is not modified, but no semantic version is assigned to that head;
- **behind**: the component's version anchor in workspace configuration names an ancestor of its canonical head;
- **dependency updates available**: a workspace dependency or env of the component currently carries a version different from the one recorded in the component's head.

Conditions SHALL be reported independently, because a component can be in more than one at once. A component with no condition SHALL be reported as clean.

The version a component is reported at SHALL be the version its canonical head carries. When the component's version anchor names a different version, both SHALL be reported, since that difference is the **behind** condition. Resolving a version anchor to a snap SHALL accept both spellings an anchor can hold: a snap version identifier, and a semantic version assigned to one of the component's snaps.

#### Scenario: A component has never been recorded

- **WHEN** a selected component has no canonical history ref
- **THEN** `status` reports it as never recorded
- **AND** reports no version for it

#### Scenario: A component has uncommitted changes

- **WHEN** a selected component's projected working content differs from its recorded head
- **THEN** `status` reports it as modified

#### Scenario: A component whose dependency has uncommitted changes

- **WHEN** a selected component's own files are unchanged but a workspace component it depends on is modified
- **THEN** `status` reports the component as modified
- **AND** names the prerequisite responsible rather than a version

#### Scenario: A component is unchanged

- **WHEN** a selected component's projected working content matches its recorded head and no other condition applies
- **THEN** `status` reports it as clean

#### Scenario: A component that has never been released

- **WHEN** a selected component is not modified and no semantic version is assigned to its canonical head
- **THEN** `status` reports it as never released

#### Scenario: A released component with nothing new

- **WHEN** a selected component is not modified and its canonical head carries an assigned semantic version
- **THEN** `status` does not report it as never released

#### Scenario: The working tree is based on an older version than the head

- **WHEN** a component's version anchor names an ancestor of its canonical head, as can happen after synchronization advances the head
- **THEN** `status` reports the component as behind, naming both the anchored version and the head version
- **AND** states that recording from this state would record content based on the older version

#### Scenario: A dependency has moved on

- **WHEN** a workspace dependency of a selected component currently carries a version different from the one that component's head records
- **THEN** `status` reports that a dependency update is available, naming the dependency and both versions

#### Scenario: An env has moved on

- **WHEN** a selected component's env currently carries a version different from the one that component's head records
- **THEN** `status` reports that an env update is available, naming the env and both versions

### Requirement: Expand component state into the changes behind it

`status` SHALL accept a detail option expanding each reported component's **modified** condition into the changes that produced it: the component-owned files that differ from the recorded head as added, modified, or deleted paths, together with the dependency, env, and other metadata changes derived from the recorded and projected component metadata.

The expanded view SHALL always compare projected working content against the recorded head. It SHALL NOT accept two recorded versions, because comparing recorded versions against each other is what `log` reports for every snap in a component's history.

The expanded view SHALL report the same components and the same conditions the summary view reports, adding detail rather than changing the answer. A component that is not modified SHALL gain no expansion.

#### Scenario: Expand a modified component

- **WHEN** a user requests detail for a component whose projected working content differs from its recorded head
- **THEN** `status` names each differing component-owned file as an added, modified, or deleted path
- **AND** names each dependency and env change behind the difference

#### Scenario: Expand a clean component

- **WHEN** a user requests detail for a component reported as clean
- **THEN** `status` reports it as clean with no expansion

#### Scenario: Expand a component modified only by a prerequisite

- **WHEN** a user requests detail for a component whose own files are unchanged but whose workspace prerequisite is modified
- **THEN** `status` reports the component as modified, names the prerequisite responsible, and lists no differing file of its own

#### Scenario: Detail does not change the summary answer

- **WHEN** the same selection is reported with and without detail
- **THEN** both report the same components with the same conditions

### Requirement: List a component's recorded history

Bit Lite SHALL provide a `log` command that lists a selected component's snaps from its canonical head backwards along its linear history. Each entry SHALL carry the snap's version identifier, the semantic versions tagged on that snap if any, and the snap's authored timestamp.

The command SHALL report a component with no canonical history as never recorded rather than failing.

#### Scenario: List a component's snaps

- **WHEN** a user requests the history of a component with several snaps
- **THEN** Bit Lite lists them from the head backwards along parent links
- **AND** lists no snap belonging to another component

#### Scenario: Decorate tagged snaps

- **WHEN** a snap in the listed history carries one or more component version tags
- **THEN** each of those semantic versions is shown on that snap's entry

#### Scenario: List a component with no history

- **WHEN** a user requests the history of a component that has never been recorded
- **THEN** Bit Lite reports it as never recorded without failing

### Requirement: Attribute every recorded version to a change source

For each listed snap that has a parent, Bit Lite SHALL report why that version exists by comparing it with its parent and classifying the change as any combination of:

- **source**: at least one component-owned file other than `.comp.json` changed;
- **deps**: at least one workspace dependency version recorded in the component metadata changed;
- **env**: the env reference recorded in the component metadata changed.

Attribution SHALL be derived from the parsed recorded metadata rather than from textual differences, so formatting or key ordering cannot be reported as a version change. A snap with no parent SHALL be reported as the component's initial version.

#### Scenario: A version produced by source changes

- **WHEN** a snap differs from its parent only in component-owned files other than `.comp.json`
- **THEN** its change source is reported as source

#### Scenario: A version produced only by a dependency moving

- **WHEN** a snap differs from its parent only in a recorded workspace dependency version
- **THEN** its change source is reported as deps, naming the dependency and both versions
- **AND** the entry indicates that no component-owned source file changed

#### Scenario: A version produced only by an env moving

- **WHEN** a snap differs from its parent only in the recorded env version
- **THEN** its change source is reported as env, naming both versions
- **AND** the entry indicates that no component-owned source file changed

#### Scenario: A version produced by both

- **WHEN** a snap differs from its parent in both component-owned files and recorded dependency or env versions
- **THEN** every applicable change source is reported

#### Scenario: The first version of a component

- **WHEN** the listed snap has no parent
- **THEN** it is reported as the component's initial version rather than attributed to a change source

### Requirement: Reproduce component content as a unified diff

Bit Lite SHALL provide a `diff` command emitting the line-by-line content difference of the selected components between two states, where a state is either a component's current working content or one of its recorded versions, named by snap version identifier or by an assigned semantic version. With no explicit states, the command SHALL compare each selected component's projected working content against its recorded head.

Comparison SHALL always be performed between projected forms, so working state and recorded state are never compared in different shapes. Recorded content SHALL be read from the store; working content SHALL be read from the component root, because the tree it belongs to is computed and never written.

Naming two recorded versions SHALL require a selection resolving to exactly one component, because a version identifier is local to one component's history. With no explicit states the command SHALL accept the same selection conventions as `status`.

#### Scenario: Compare working state against the head

- **WHEN** a user diffs a component without naming states
- **THEN** Bit Lite emits the difference between its projected working content and its recorded head

#### Scenario: Compare two recorded versions

- **WHEN** a user diffs a component naming two recorded versions
- **THEN** Bit Lite emits the difference between those two snaps
- **AND** does not read the component's working directory content into the comparison

#### Scenario: Compare against a semantic version

- **WHEN** a user names a semantic version assigned to one of the component's snaps
- **THEN** Bit Lite resolves it to that snap and compares against it

#### Scenario: Name a version that does not exist

- **WHEN** a user names a version that is not a recorded snap of that component
- **THEN** the command fails naming the component and the unresolved version

#### Scenario: Name two versions for more than one component

- **WHEN** a user names two recorded versions with a selection matching more than one component
- **THEN** the command fails naming the matched components

#### Scenario: Diff several components at once

- **WHEN** a user diffs without naming states and the selection matches several changed components
- **THEN** the output carries every changed component's difference in one patch, ordered by component identifier

### Requirement: Emit differences in unified diff format

The content difference SHALL be emitted as a unified diff carrying the conventional `diff --git` header, the `---` and `+++` file lines, and `@@` hunk headers, so a redirected diff is a patch file that existing tooling recognizes and editors highlight.

Paths SHALL be addressed in the workspace's own vocabulary as `a/<component-id>::<component-relative-path>` and `b/<component-id>::<component-relative-path>`. The separator SHALL make the boundary between the component identifier and the file path unambiguous, since both otherwise contain slashes, and SHALL keep two components owning a file of the same name from colliding on one path within a single patch. Bit Lite SHALL NOT claim these paths are applicable to a checkout.

Each component's patches SHALL be preceded by a banner naming the component and the two states being compared. The banner states the version transition once for the whole component rather than repeating it on every file header. Every banner line SHALL begin with a character that carries no meaning in unified diff, so that no banner line can be read as a file marker, a hunk header, or an added or deleted line.

An added file SHALL be emitted against `/dev/null` with its new file mode, a deleted file against `/dev/null` with its deleted file mode, and a file whose mode changed but whose content did not SHALL still be emitted so the mode change is visible. Content that is not valid UTF-8 SHALL be reported as differing binary rather than rendered as lines.

Standard output SHALL carry the patch and nothing else, so redirecting it produces a valid `*.diff` file. Any advisory Bit Lite needs to add SHALL be written to standard error.

#### Scenario: A modified file

- **WHEN** a component-owned file's content differs between the two states
- **THEN** the output carries a `diff --git` header naming the component-qualified path on both sides, and hunks showing the differing lines with surrounding context

#### Scenario: Separate several components in one patch

- **WHEN** the output carries more than one component
- **THEN** each component's patches are preceded by a banner naming that component and its two states
- **AND** no banner line begins with a character that unified diff gives meaning to

#### Scenario: Two components own a file of the same name

- **WHEN** two components in one patch each own a file at the same component-relative path
- **THEN** the two files appear on distinct paths, each naming its own component

#### Scenario: An added file

- **WHEN** a file exists only on the later side
- **THEN** the output records it as a new file with its mode, against `/dev/null` on the earlier side

#### Scenario: A deleted file

- **WHEN** a file exists only on the earlier side
- **THEN** the output records it as a deleted file with its mode, against `/dev/null` on the later side

#### Scenario: Only the file mode changed

- **WHEN** a file's content is identical on both sides but its mode differs
- **THEN** the output records the mode change and emits no content hunk

#### Scenario: A binary file

- **WHEN** a differing file's content on either side is not valid UTF-8
- **THEN** the output records that the binary files differ instead of rendering lines

#### Scenario: Redirect the output to a file

- **WHEN** a user redirects the command's standard output
- **THEN** the resulting file contains only the patch

#### Scenario: Nothing differs

- **WHEN** no selected component's content differs between the two states
- **THEN** the command emits an empty patch and succeeds

### Requirement: Status and snap agree on whether a component changed

`status` SHALL report a component as modified if and only if recording that component would act on it. The two commands SHALL derive this answer from the same projected working tree and the same recorded head tree.

Because a component's projection names its workspace dependencies' versions, a component whose prerequisite is modified SHALL itself be reported as modified, applied transitively over the prerequisite graph. Inspection SHALL determine this from the prerequisite's own state rather than by predicting the version that recording would assign it, which is not available to a command that writes nothing.

An empty patch from `diff` SHALL NOT be taken to carry this guarantee. A component modified only because a prerequisite is modified has no content difference of its own, since inspection resolves that prerequisite to the version at its own head, and a patch has nothing to show. Where `diff` emits an empty patch for a component `status` reports as modified, it SHALL say so on standard error rather than on standard output, so the emitted patch stays valid.

#### Scenario: An unchanged component

- **WHEN** a component's projected working content matches its recorded head
- **THEN** `status` reports it as clean
- **AND** recording the component reports it as unchanged and creates no commit

#### Scenario: A component changed only by a dependency version

- **WHEN** a workspace dependency of a component has received a new version and the component's own files are unchanged
- **THEN** `status` reports the component as modified and names the dependency change
- **AND** recording the component creates a new commit

#### Scenario: A component whose dependency has uncommitted changes

- **WHEN** a component's own files are unchanged and a workspace component it depends on is modified
- **THEN** `status` reports the component as modified because of that dependency
- **AND** recording both components in one operation creates a commit for each

#### Scenario: A component modified only by a prerequisite produces an empty patch

- **WHEN** a user diffs a component whose own files are unchanged but whose workspace prerequisite is modified
- **THEN** the patch on standard output is empty
- **AND** an advisory naming the prerequisite responsible is written to standard error

### Requirement: Inspection resolves dependency versions without refusing

When inspecting a component, Bit Lite SHALL resolve every workspace dependency and env to the version recorded at that prerequisite's own canonical head, whatever the prerequisite's working state, and SHALL NOT fail because a prerequisite is outside the selection, has never been recorded, or has uncommitted changes. Where recording refuses such a prerequisite, inspection SHALL report it instead.

#### Scenario: Inspect a component whose dependency has uncommitted changes

- **WHEN** an inspection command selects a component whose workspace dependency is modified and outside the selection
- **THEN** the command reports the component rather than failing

#### Scenario: Inspect a component whose dependency has never been recorded

- **WHEN** an inspection command selects a component whose workspace dependency has never been recorded
- **THEN** the command reports the component rather than failing
- **AND** reports that the dependency has never been recorded

### Requirement: Present component metadata changes semantically where Bit Lite reports

Wherever Bit Lite reports on a comparison rather than reproducing its content — `status --detail` and `log` — it SHALL NOT present `.comp.json` as a changed file or as a textual difference. It SHALL instead report the component's metadata changes as added, removed, and changed dependency entries and as env reference changes, naming the package and the versions on each side. All other component-owned files SHALL be reported as added, modified, or deleted paths.

Any difference in recorded component metadata that is not a dependency or env change SHALL still be reported, so no metadata change can be silently omitted.

`diff` reproduces content rather than reporting on it, and SHALL therefore include `.comp.json` as an ordinary file patch. A patch that omitted a file the snap records would be an incomplete account of the difference between two states.

#### Scenario: A dependency version changed

- **WHEN** a report finds a different recorded version for a workspace dependency
- **THEN** the output names the dependency, the version on each side, and does not list `.comp.json` as a changed file

#### Scenario: Component metadata differs in a patch

- **WHEN** `diff` compares two states whose recorded component metadata differs
- **THEN** the patch carries `.comp.json` as an ordinary file with its content hunks

#### Scenario: A dependency was added or removed

- **WHEN** a report finds a dependency present on only one side
- **THEN** the output reports it as added or removed with its version

#### Scenario: The env reference changed

- **WHEN** a report finds a different recorded env package or env version
- **THEN** the output reports the env change separately from dependency changes

#### Scenario: Source files changed

- **WHEN** a report finds differences in component-owned files other than `.comp.json`
- **THEN** each is reported as an added, modified, or deleted component-relative path

#### Scenario: An unrecognized metadata difference

- **WHEN** recorded component metadata differs in a way that is neither a dependency nor an env change
- **THEN** the output still reports that the component's metadata changed

### Requirement: Inspection follows workspace selection conventions

Inspection commands SHALL accept the same component selection conventions as other workspace commands, selecting every registered component when no filter is supplied and reporting an error when a supplied filter matches no registered component. Where a command's output is meaningful only for one component at a time — `log`, and `diff` when two recorded versions are named — it SHALL require a selection resolving to exactly one component.

Inspection SHALL derive every fact it reports from declared workspace state, component roots, and the component history store alone. It SHALL NOT require resolved envs or installed packages, so inspection works in a workspace where nothing has been installed.

Every inspection command SHALL be able to produce its result as machine-readable structured output carrying the same facts as its human-readable form, with version identifiers unabbreviated.

#### Scenario: Inspect a workspace with nothing installed

- **WHEN** an inspection command runs in a workspace whose dependencies have never been installed
- **THEN** it reports every selected component's state

#### Scenario: Inspect all components

- **WHEN** a user runs `status` without filters
- **THEN** every registered workspace component is reported

#### Scenario: A filter matches nothing

- **WHEN** a supplied filter matches no registered component
- **THEN** the command fails with the same diagnostic other workspace commands produce

#### Scenario: A single-component command receives an ambiguous selection

- **WHEN** a selection for a command that reports one component matches more than one
- **THEN** the command fails naming the matched components

#### Scenario: Machine-readable output

- **WHEN** a user requests structured output from an inspection command
- **THEN** the result carries the same facts as the human-readable output
- **AND** every version identifier appears in full

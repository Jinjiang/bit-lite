## ADDED Requirements

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
- **modified**: the component's projected working content differs from its recorded head;
- **behind**: the component's version anchor in workspace configuration names an ancestor of its canonical head;
- **dependency updates available**: a workspace dependency or env of the component currently carries a version different from the one recorded in the component's head.

Conditions SHALL be reported independently, because a component can be in more than one at once. A component with no condition SHALL be reported as clean.

#### Scenario: A component has never been recorded

- **WHEN** a selected component has no canonical history ref
- **THEN** `status` reports it as never recorded
- **AND** reports no version for it

#### Scenario: A component has uncommitted changes

- **WHEN** a selected component's projected working content differs from its recorded head
- **THEN** `status` reports it as modified

#### Scenario: A component is unchanged

- **WHEN** a selected component's projected working content matches its recorded head and no other condition applies
- **THEN** `status` reports it as clean

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

### Requirement: Compare a component between two states

Bit Lite SHALL provide a `diff` command comparing a component between two states, where a state is either the component's current working content or one of its recorded versions, named by snap version identifier or by an assigned semantic version. With no explicit states, the command SHALL compare the component's projected working content against its recorded head.

Comparison SHALL always be performed between projected forms, so working state and recorded state are never compared in different shapes.

#### Scenario: Compare working state against the head

- **WHEN** a user diffs a component without naming states
- **THEN** Bit Lite compares its projected working content against its recorded head

#### Scenario: Compare two recorded versions

- **WHEN** a user diffs a component naming two recorded versions
- **THEN** Bit Lite compares those two snaps
- **AND** does not read the component's working directory content into the comparison

#### Scenario: Compare against a semantic version

- **WHEN** a user names a semantic version assigned to one of the component's snaps
- **THEN** Bit Lite resolves it to that snap and compares against it

#### Scenario: Name a version that does not exist

- **WHEN** a user names a version that is not a recorded snap of that component
- **THEN** the command fails naming the component and the unresolved version

### Requirement: Diff and snap agree on whether a component changed

A default comparison SHALL report no changes for a component if and only if recording that component would report it unchanged. The two commands SHALL derive this answer from the same projected working tree and the same recorded head tree.

#### Scenario: An unchanged component

- **WHEN** a component's projected working content matches its recorded head
- **THEN** a default diff reports no changes
- **AND** recording the component reports it as unchanged and creates no commit

#### Scenario: A component changed only by a dependency version

- **WHEN** a workspace dependency of a component has received a new version and the component's own files are unchanged
- **THEN** a default diff reports the dependency version change
- **AND** recording the component creates a new commit

### Requirement: Present component metadata changes semantically

Bit Lite SHALL NOT present `.comp.json` as a changed file or as a textual difference. It SHALL instead report the component's metadata changes as added, removed, and changed dependency entries and as env reference changes, naming the package and the versions on each side. All other component-owned files SHALL be reported as added, modified, or deleted paths.

Any difference in recorded component metadata that is not a dependency or env change SHALL still be reported, so no metadata change can be silently omitted.

#### Scenario: A dependency version changed

- **WHEN** a comparison finds a different recorded version for a workspace dependency
- **THEN** the output names the dependency, the version on each side, and does not list `.comp.json` as a changed file

#### Scenario: A dependency was added or removed

- **WHEN** a comparison finds a dependency present on only one side
- **THEN** the output reports it as added or removed with its version

#### Scenario: The env reference changed

- **WHEN** a comparison finds a different recorded env package or env version
- **THEN** the output reports the env change separately from dependency changes

#### Scenario: Source files changed

- **WHEN** a comparison finds differences in component-owned files other than `.comp.json`
- **THEN** each is reported as an added, modified, or deleted component-relative path

#### Scenario: An unrecognized metadata difference

- **WHEN** recorded component metadata differs in a way that is neither a dependency nor an env change
- **THEN** the output still reports that the component's metadata changed

### Requirement: Inspection follows workspace selection conventions

Inspection commands SHALL accept the same component selection conventions as other workspace commands, selecting every registered component when no filter is supplied and reporting an error when a supplied filter matches no registered component. Commands reporting one component at a time SHALL require a selection resolving to exactly one component.

Every inspection command SHALL be able to produce its result as machine-readable structured output carrying the same facts as its human-readable form, with version identifiers unabbreviated.

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

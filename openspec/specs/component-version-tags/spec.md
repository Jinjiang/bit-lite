## Purpose

Define immutable, component-scoped semantic versions that name existing component snaps through annotated Git tags.
## Requirements
### Requirement: Assign a semantic tag to an existing component snap

Bit Lite SHALL provide a `tag` command that selects components using the same conventions as other workspace commands, selecting every registered component when no filter is supplied, and processes the selection in the dependency order defined by the `component-version-resolution` capability. For each selected component it SHALL create an annotated Git tag at `refs/tags/components/<component-key>/<version>` pointing to the snap that carries that component's tagged content, using the same component-key encoding as component history refs.

Before tagging each component, Bit Lite SHALL project its metadata as defined by the `component-version-resolution` capability, resolving workspace dependency and env versions to the versions those components carry at that point in the operation. When the projection changes the component's tree, Bit Lite SHALL create a snap carrying the projected content and tag that snap. When the projection leaves the tree unchanged, any tag Bit Lite creates SHALL point at the component's existing current snap. Tagging SHALL NOT create a snap in any other circumstance.

#### Scenario: Tag the current snap

- **WHEN** a user tags a component whose projected content matches its current snap and whose snap carries no assigned version
- **THEN** Bit Lite creates an annotated component tag pointing directly to that snap commit
- **AND** reports the component ID, version, and algorithm-qualified snap ID
- **AND** creates no new commit

#### Scenario: Tag a component whose dependency versions changed

- **WHEN** a user tags a component whose projected `.comp.json` names different dependency or env versions than its current snap records
- **THEN** Bit Lite creates a snap carrying the projected content as a child of the component's current snap
- **AND** creates the annotated component tag pointing at that new snap

#### Scenario: Tag a dependency and its dependent together

- **WHEN** a user tags a selection containing a component and a workspace component it depends on
- **THEN** the dependency is tagged first
- **AND** the dependent's tagged content names the semantic version just assigned to that dependency rather than a snap identifier

#### Scenario: Tag every registered component

- **WHEN** a user runs `tag` without component filters
- **THEN** Bit Lite attempts to tag every registered workspace component as one operation

#### Scenario: Tag a component that has never been snapped

- **WHEN** a user tags a component whose canonical history ref does not exist
- **THEN** the command fails without creating a snap or tag

#### Scenario: Reject an invalid semantic version

- **WHEN** the requested version is not a valid version for a component
- **THEN** the command fails before creating or changing any snap or tag ref

#### Scenario: Reject ambiguous component selection

- **WHEN** the component selector matches zero registered components, or matches more than one while an explicit version is supplied
- **THEN** the command fails without creating a snap or changing any tag ref

### Requirement: Component tags are immutable and idempotent

A component version tag SHALL be immutable after creation. Repeating the same tag operation against the same snap SHALL succeed without changing the tag object or ref; attempting to assign the same component version to another snap SHALL fail.

#### Scenario: Repeat an identical tag operation

- **WHEN** the requested component version tag already resolves to the component's current snap
- **THEN** Bit Lite reports the tag as unchanged
- **AND** preserves the existing annotated tag object and ref

#### Scenario: Reassign an existing version

- **WHEN** the requested component version tag already resolves to a different snap
- **THEN** Bit Lite reports an immutable-tag conflict
- **AND** does not move or replace the existing tag ref

### Requirement: Tags remain scoped to component histories

Bit Lite SHALL validate that a component tag target is reachable from that component's canonical history and SHALL not use one component's snap as another component's version target.

#### Scenario: Inspect an existing component tag

- **WHEN** Bit Lite validates or synchronizes a component tag
- **THEN** it peels the annotated tag to a commit reachable from the corresponding component history ref
- **AND** treats a tag with a cross-component or unreachable target as invalid store state

### Requirement: A component with nothing new is skipped

A recording command SHALL leave a component untouched when nothing about it is new. For `snap` that means its projected content matches its current snap. For `tag` it means both that its projected content matches its current snap **and** that the snap already carries an assigned version, since a component whose content is unchanged but has never been released still has something to release.

A skipped component SHALL keep the version it already carries, and that version SHALL be what its dependents resolve to. Repeating a command therefore changes nothing: versions SHALL NOT advance for components in which nothing happened.

An explicit version SHALL override the skip, because the user named that version deliberately.

#### Scenario: Repeat a tag with nothing changed

- **WHEN** a user tags a selection twice with no change to any component's content, dependency versions, or env in between
- **THEN** the second operation assigns no version, creates no snap, and creates no tag
- **AND** every component still carries the version the first operation assigned

#### Scenario: Repeat a snap with nothing changed

- **WHEN** a user snaps a selection twice with no change in between
- **THEN** the second operation creates no commit and moves no ref

#### Scenario: A skipped dependency does not disturb its dependents

- **WHEN** a component is skipped because nothing about it is new
- **THEN** its dependents resolve it to the version it already carries
- **AND** those dependents are themselves skipped when nothing else about them changed

#### Scenario: An unchanged component that has never been released

- **WHEN** a component's content is unchanged but its snap carries no assigned version
- **THEN** tagging assigns it a version rather than skipping it

#### Scenario: Only the changed components advance

- **WHEN** a selection contains both components with changes and components without
- **THEN** only the changed components receive new versions

#### Scenario: An explicit version overrides the skip

- **WHEN** a user supplies an explicit version for a component whose content is unchanged and already carries a version
- **THEN** that version is assigned rather than skipped

### Requirement: Derive a version for every tagged component

Bit Lite SHALL derive each selected component's version independently, by incrementing the patch of the highest version already assigned to that component. A component with no assigned version SHALL receive `0.0.1`.

The base for the increment SHALL come from the component's existing version tags rather than from its version anchor, because after a snap the anchor holds a snap identifier, which is not a semantic version and carries no ordering.

A user MAY override the derived version with an explicit version, and Bit Lite SHALL accept that override only when the selection resolves to exactly one component, because a single explicit version cannot describe several components.

#### Scenario: Derive the first version of a component

- **WHEN** a component with no assigned version is tagged without an explicit version
- **THEN** it receives version `0.0.1`

#### Scenario: Increment from the highest assigned version

- **WHEN** a component already carries versions `0.1.0` and `0.2.3` and is tagged without an explicit version
- **THEN** it receives version `0.2.4`

#### Scenario: Derive versions independently across components

- **WHEN** several components with different existing versions and with changes are tagged in one operation
- **THEN** each receives its own incremented version rather than a shared one

#### Scenario: Override the derived version for one component

- **WHEN** a user supplies an explicit version and the selection resolves to exactly one component
- **THEN** that component receives the supplied version instead of the derived one

#### Scenario: Reject an explicit version for several components

- **WHEN** a user supplies an explicit version and the selection resolves to more than one component
- **THEN** the command fails without creating a snap or changing any tag ref

### Requirement: Assigned component versions are exactly major.minor.patch

An assigned component version SHALL consist of exactly three numeric parts. Bit Lite SHALL refuse a prerelease, build metadata, a leading `v`, a range, and any loose spelling such as `1.0`.

This also excludes the generated snap version identifier shape defined by the `component-version-resolution` capability, since that shape is a prerelease, so a manually assigned version can never collide with an identifier Bit Lite generates. When a user supplies a value in that shape, the diagnostic SHALL say it is a snap identifier rather than only that prereleases are refused.

#### Scenario: Accept a plain three-part version

- **WHEN** a user supplies a version such as `1.4.2`
- **THEN** the command proceeds

#### Scenario: Reject a prerelease or build metadata

- **WHEN** a user supplies a version such as `1.4.2-rc.1` or `1.4.2+build.5`
- **THEN** the command fails explaining that an assigned version must be exactly `major.minor.patch`
- **AND** creates no snap and changes no tag ref

#### Scenario: Reject a snap identifier

- **WHEN** a user supplies a version spelled as a generated snap version identifier
- **THEN** the command fails explaining that the value is a snap identifier
- **AND** creates no snap and changes no tag ref

### Requirement: Recording commands share one option surface

The `snap` and `tag` commands SHALL both accept `--dry-run`, `--json`, and `--message`.

`--dry-run` SHALL report exactly what the command would do and SHALL change nothing: no ref, no tag, and no version anchor. `--json` SHALL emit the command's structured result with version identifiers unabbreviated. `--message` SHALL replace the command's generated commit or tag message, and its absence SHALL keep each command's existing deterministic default.

A supplied message SHALL NOT affect whether a component is recorded, because content comparison happens before any commit is created.

#### Scenario: Preview a recording without changing anything

- **WHEN** a user runs `snap` or `tag` with `--dry-run`
- **THEN** the command reports the components it would record and the versions they would receive
- **AND** no component history ref, tag ref, or version anchor changes

#### Scenario: Emit a structured result

- **WHEN** a user runs `snap` or `tag` with `--json`
- **THEN** the result carries the same facts as the human-readable output with complete version identifiers

#### Scenario: Supply a message

- **WHEN** a user supplies `--message`
- **THEN** the created commit or tag carries that message instead of the generated default

#### Scenario: A message does not create a version

- **WHEN** a user supplies `--message` for a component whose content is unchanged
- **THEN** the component is still reported as unchanged and no commit is created


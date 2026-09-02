## MODIFIED Requirements

### Requirement: Assign a semantic tag to an existing component snap

Bit Lite SHALL provide a `tag` command that selects exactly one registered component and validates a strict semantic version. It SHALL create an annotated Git tag at `refs/tags/components/<component-key>/<version>` pointing to the snap that carries the component's tagged content, using the same component-key encoding as component history refs.

Before tagging, Bit Lite SHALL project the component's metadata as defined by the `component-version-resolution` capability, resolving workspace dependency and env versions to the versions those components carry at that moment. When the projection leaves the component's tree unchanged, the tag SHALL point at the component's existing current snap and no commit SHALL be created. When the projection changes the component's tree, Bit Lite SHALL create a snap carrying the projected content and tag that snap. Tagging SHALL NOT create a snap in any other circumstance.

#### Scenario: Tag the current snap

- **WHEN** a user tags a component whose projected content matches its current snap, with a valid semantic version
- **THEN** Bit Lite creates an annotated component tag pointing directly to that snap commit
- **AND** reports the component ID, version, and algorithm-qualified snap ID
- **AND** creates no new commit

#### Scenario: Tag a component whose dependency versions changed

- **WHEN** a user tags a component whose projected `.comp.json` names different dependency or env versions than its current snap records
- **THEN** Bit Lite creates a snap carrying the projected content as a child of the component's current snap
- **AND** creates the annotated component tag pointing at that new snap

#### Scenario: Tag a component that has never been snapped

- **WHEN** a user tags a component whose canonical history ref does not exist
- **THEN** the command fails without creating a snap or tag

#### Scenario: Reject an invalid semantic version

- **WHEN** the requested version is not a valid strict semantic version
- **THEN** the command fails before creating or changing any snap or tag ref

#### Scenario: Reject ambiguous component selection

- **WHEN** the component selector matches zero or more than one registered component
- **THEN** the command fails without creating a snap or changing any tag ref

## ADDED Requirements

### Requirement: Generated snap version identifiers are a reserved namespace

Bit Lite SHALL refuse a user-supplied component version matching the generated snap version identifier shape defined by the `component-version-resolution` capability, so a manually assigned version can never collide with an identifier Bit Lite generates for a snap.

#### Scenario: Reject a version in the reserved shape

- **WHEN** a user requests a component version spelled as a generated snap version identifier
- **THEN** the command fails explaining that the shape is reserved for snap identifiers
- **AND** creates no snap and changes no tag ref

#### Scenario: Accept an ordinary prerelease version

- **WHEN** a user requests a strict semantic version with a prerelease that is not the reserved shape
- **THEN** the command proceeds normally

## ADDED Requirements

### Requirement: Assign a semantic tag to an existing component snap

Bit Lite SHALL provide a `tag` command that selects exactly one registered component and validates a strict semantic version. It SHALL create an annotated Git tag at `refs/tags/components/<component-key>/<version>` pointing to the component's current snap, using the same component-key encoding as component history refs.

#### Scenario: Tag the current snap

- **WHEN** a user tags a component that has a current snap with a valid semantic version
- **THEN** Bit Lite creates an annotated component tag pointing directly to that snap commit
- **AND** reports the component ID, version, and algorithm-qualified snap ID

#### Scenario: Tag a component that has never been snapped

- **WHEN** a user tags a component whose canonical history ref does not exist
- **THEN** the command fails without creating a snap or tag

#### Scenario: Reject an invalid semantic version

- **WHEN** the requested version is not a valid strict semantic version
- **THEN** the command fails before creating or changing any tag ref

#### Scenario: Reject ambiguous component selection

- **WHEN** the component selector matches zero or more than one registered component
- **THEN** the command fails without changing any tag ref

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

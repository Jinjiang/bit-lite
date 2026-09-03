# component-version-resolution Specification

## Purpose
TBD - created by archiving change dependency-aware-versioning. Update Purpose after archive.
## Requirements
### Requirement: Snap version identifiers

Bit Lite SHALL express the version of a component snap as `0.0.0-g<object-id-hex>`, where `<object-id-hex>` is the complete hexadecimal Git object ID of that snap's commit in the store's object format. The `g` prefix SHALL always be present so the prerelease identifier is alphanumeric and cannot become an invalid numeric identifier with a leading zero.

Snap version identifiers SHALL be treated as opaque identifiers and SHALL NOT be treated as ordered versions. Bit Lite SHALL NOT sort them, compute a maximum over them, or derive a "latest" version from them; ordering between snaps SHALL be determined through commit ancestry in the store.

Human-facing output MAY abbreviate the object ID for readability, but every value written into a file or a Git object SHALL carry the complete object ID.

#### Scenario: Format a snap version

- **WHEN** Bit Lite records a component snap whose commit object ID is known
- **THEN** the component's version is `0.0.0-g` followed by the complete hexadecimal object ID
- **AND** the same value resolves back to that commit through the store

#### Scenario: Abbreviate a snap version for display

- **WHEN** Bit Lite prints a snap version in command output
- **THEN** it may show an abbreviated object ID
- **AND** the value written into component metadata remains the complete object ID

#### Scenario: Snap versions are not ordered

- **WHEN** two snaps of the same component are compared
- **THEN** Bit Lite determines which is later through commit ancestry
- **AND** does not rely on semantic-version precedence between their version identifiers

### Requirement: Committed component metadata is a projection of workspace state

The `.comp.json` recorded in a component commit SHALL be derived from workspace state rather than copied from the working file. Bit Lite SHALL produce it by applying exactly two transformations to the component's working `.comp.json`:

1. resolving every dependency whose declared specifier is the workspace placeholder to the recorded version of the workspace component providing that package;
2. injecting an `env` field carrying the component's env package name and version as declared in `bit-lite.json`, with a workspace placeholder resolved to the recorded version of the local env component and any other specifier recorded exactly as declared.

Bit Lite SHALL NOT record the resolved installed version of an external env package, so that recording remains independent of installation state. All other component-owned files SHALL be captured byte for byte.

#### Scenario: Record a component that depends on a workspace component

- **WHEN** a component whose `.comp.json` declares a workspace-placeholder dependency is recorded
- **THEN** the committed `.comp.json` names that dependency's resolved version
- **AND** contains no workspace placeholder

#### Scenario: Record a component that uses a local env

- **WHEN** a component whose `bit-lite.json` entry declares a workspace-placeholder env is recorded
- **THEN** the committed `.comp.json` contains an `env` field naming the env package and the env component's resolved version

#### Scenario: Record a component that uses an external env

- **WHEN** a component's `bit-lite.json` entry declares an env with a non-placeholder specifier
- **THEN** the committed `.comp.json` records that declared specifier
- **AND** recording succeeds without resolving or reading any installed env package

#### Scenario: The version anchor never enters the commit

- **WHEN** a component is recorded
- **THEN** no version anchor appears anywhere in the committed tree, because anchors live outside every component root

#### Scenario: Re-recording an unchanged component

- **WHEN** a component is recorded twice with no change to its files, its dependencies' versions, or its env's version
- **THEN** the second operation reports the component as unchanged and creates no commit

### Requirement: The workspace component file retains its authored form

Bit Lite SHALL NOT rewrite a working `.comp.json`. The workspace placeholder SHALL remain the declared form of a dependency on another workspace component, and SHALL remain the signal by which workspace commands distinguish a local component from an external package.

#### Scenario: Placeholders survive recording

- **WHEN** a component with workspace-placeholder dependencies is recorded
- **THEN** its working `.comp.json` still declares those dependencies with the workspace placeholder

#### Scenario: Recording leaves component files untouched

- **WHEN** a recording operation completes successfully
- **THEN** no component-owned file has been modified

### Requirement: The version anchor lives in workspace configuration

Each component entry in the workspace configuration SHALL carry an optional `version` field recording the version that component is currently based on, alongside that entry's env reference. A component that has never been recorded SHALL have no `version` field.

The workspace configuration SHALL be the only workspace file a recording command writes back, and it SHALL be written only after the operation's ref updates have succeeded, as one file update that preserves the file's existing entry order and formatting. Because the workspace configuration lies outside every component root, no anchor SHALL ever be captured by a snap.

Bit Lite SHALL reject registering a component whose root resolves to the workspace root, so the workspace configuration can never fall inside a captured component tree.

#### Scenario: The version anchor is written after publication

- **WHEN** a recording operation completes successfully
- **THEN** each recorded component's configuration entry carries the version just assigned to it
- **AND** every other component entry is unchanged

#### Scenario: A failed operation writes nothing

- **WHEN** a recording operation fails at any point before or during ref publication
- **THEN** the workspace configuration is not modified

#### Scenario: A component that has never been recorded

- **WHEN** a component's configuration entry has no `version` field
- **THEN** Bit Lite treats the component as having no recorded version

#### Scenario: Reject a component registered at the workspace root

- **WHEN** a component entry declares a path resolving to the workspace root
- **THEN** loading the workspace fails naming that component

### Requirement: Recording commands process components in dependency order

Bit Lite SHALL prepare selected components in an order in which every component's workspace prerequisites are prepared before the component itself. A component's prerequisites SHALL be the workspace components providing its placeholder dependencies together with the workspace component providing its env, when the env is declared with a workspace placeholder.

This prerequisite definition SHALL be shared by every command that needs component ordering, so compilation and recording cannot disagree about the graph. A cycle in the prerequisite graph SHALL fail the operation.

#### Scenario: Record a dependency before its dependent

- **WHEN** a selection contains a component and a workspace component it depends on
- **THEN** the dependency is prepared first
- **AND** the dependent's committed metadata names the version just assigned to that dependency

#### Scenario: Record an env before its users

- **WHEN** a selection contains a component and the local env component it selects
- **THEN** the env component is prepared first
- **AND** the component's committed metadata names the version just assigned to that env

#### Scenario: Prerequisite cycle

- **WHEN** the selected components form a cycle through dependency or env edges
- **THEN** the operation fails and reports the cycle
- **AND** no component history ref is advanced

### Requirement: Unresolvable workspace dependencies fail the operation

When a component being recorded declares a workspace-placeholder dependency or env on a workspace component that is not part of the current selection, Bit Lite SHALL resolve it to that component's recorded head version only when the component's working content matches that head. Otherwise the operation SHALL fail.

Bit Lite SHALL fail when the prerequisite component has never been recorded, and SHALL fail when the prerequisite component has a recorded head but its working content differs from it. Working content is compared by the candidate tree the ordinary snapshot rules produce, independent of any source-control state outside the component history store. The diagnostic SHALL name the offending component and the selected component that depends on it.

#### Scenario: Prerequisite outside the selection is unrecorded

- **WHEN** a selected component depends on a workspace component that has never been recorded
- **AND** that component is not part of the selection
- **THEN** the operation fails naming both components
- **AND** no component history ref is advanced

#### Scenario: Prerequisite outside the selection has uncommitted changes

- **WHEN** a selected component depends on a workspace component whose working content differs from its recorded head
- **AND** that component is not part of the selection
- **THEN** the operation fails naming both components
- **AND** no component history ref is advanced

#### Scenario: Prerequisite outside the selection is unchanged

- **WHEN** a selected component depends on a workspace component whose working content matches its recorded head
- **AND** that component is not part of the selection
- **THEN** the selected component's committed metadata names that component's head version
- **AND** the prerequisite component is not recorded again

### Requirement: Generated package manifests carry component versions

The generated package manifest Bit Lite writes for a linked component SHALL declare a version for every workspace dependency instead of a workspace placeholder, and SHALL declare the component's own version rather than a fixed placeholder value. Both values SHALL come from the relevant component's version anchor in the workspace configuration, and SHALL be `0.0.0` when that component has no recorded version.

Linking SHALL NOT read the component history store.

#### Scenario: Link a component with a recorded dependency

- **WHEN** a component that depends on a recorded workspace component is linked
- **THEN** its generated manifest declares that dependency at the dependency's current version
- **AND** the manifest declares no workspace placeholder

#### Scenario: Link a component that has never been recorded

- **WHEN** a component with no recorded version is linked
- **THEN** its generated manifest declares its own version as `0.0.0`
- **AND** any dependency without a recorded version is declared as `0.0.0`

#### Scenario: Link without a component history store

- **WHEN** linking runs in a workspace that has no component history store
- **THEN** linking succeeds without creating or reading one


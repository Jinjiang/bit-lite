## MODIFIED Requirements

### Requirement: Complete deterministic component file capture

For v1, Bit Lite SHALL recursively capture every regular file owned by the component root, including source, docs, demos, tests, assets, dotfiles, and `.comp.json`. The commit tree SHALL mirror paths relative to the component root and SHALL NOT introduce a wrapper directory or Bit Lite-generated manifest.

Every captured file except `.comp.json` SHALL be recorded with the exact bytes present in the component directory. `.comp.json` SHALL be recorded as the projection of workspace state defined by the `component-version-resolution` capability, so its committed content does not match the working file. No other file SHALL be substituted or transformed.

Bit Lite SHALL prune `.git`, `.bit`, `.bit-lite`, `.bit-lite-store.git`, `node_modules`, `dist`, `build`, and `coverage` directories at any depth. It SHALL preserve file bytes and executable-file mode without applying Git clean or smudge filters. Empty directories SHALL have no representation because Git trees contain files rather than directories.

#### Scenario: Capture all component-owned file categories

- **WHEN** a component contains implementation files, documentation, demos, tests, assets, dotfiles, and `.comp.json`
- **THEN** the snap tree contains each regular file at the same component-relative path
- **AND** every file except `.comp.json` has the same bytes as the working file

#### Scenario: Capture the projected component metadata

- **WHEN** a component is snapped
- **THEN** the snap tree's `.comp.json` is the projection of workspace state rather than the working file's bytes

#### Scenario: Exclude generated and internal directories

- **WHEN** a component contains a pruned directory at any depth
- **THEN** Bit Lite does not traverse that directory or include any of its contents in the snap tree

#### Scenario: Preserve executable mode

- **WHEN** a captured regular file is executable
- **THEN** its Git tree entry records executable-file mode

#### Scenario: Reject symbolic links

- **WHEN** a selected component contains a symbolic link anywhere below its root outside a pruned directory
- **THEN** the entire snap operation fails with the component-relative link path
- **AND** no selected component history ref is advanced

### Requirement: Workspace-aware component selection

The `snap` command SHALL resolve components through the existing Bit Lite workspace model and SHALL accept the same canonical component-selection conventions used by workspace commands. With no component filters, it SHALL select every registered workspace component.

Selected components SHALL be prepared in the dependency order defined by the `component-version-resolution` capability rather than in selection order, and a selected component whose workspace prerequisites cannot be resolved SHALL fail the operation.

#### Scenario: Snap selected components

- **WHEN** a user supplies component filters to `bit-lite snap`
- **THEN** Bit Lite captures only matching registered components
- **AND** reports an error when no registered component matches

#### Scenario: Snap all workspace components

- **WHEN** a user runs `bit-lite snap` without component filters
- **THEN** Bit Lite attempts to capture every registered component as one local operation

#### Scenario: Prepare selected components in dependency order

- **WHEN** a selection contains components related by dependency or env edges
- **THEN** each component is prepared after every workspace prerequisite it depends on

### Requirement: Explicit v1 snapshot boundary

V1 component snaps SHALL derive versioned content from the captured component directory and from the workspace facts required to identify what the component was built against: the recorded versions of its workspace dependencies and its declared env reference. Bit Lite SHALL NOT implicitly add any other workspace-level configuration, dependency inference, package-manager state, resolved installed package versions, build artifacts, caches, or generated output to the component commit.

#### Scenario: Workspace policy changes without component or dependency changes

- **WHEN** `bit-lite.json` changes in a way that does not alter the component's env reference or any of its dependencies' versions, or inferred dependencies or package-manager state change, without changing the component's files
- **THEN** the next snap reports that component as unchanged

#### Scenario: Version anchors are outside every captured tree

- **WHEN** a component is snapped in a workspace whose configuration records version anchors
- **THEN** no anchor appears in the snap tree, because the workspace configuration lies outside every component root

#### Scenario: A dependency's version changes without component file changes

- **WHEN** a workspace dependency of a component receives a new version and the component's own files are unchanged
- **THEN** the next snap of that component records a new commit whose projected `.comp.json` names the dependency's new version

#### Scenario: An env's version changes without component file changes

- **WHEN** a component's local env component receives a new version and the component's own files are unchanged
- **THEN** the next snap of that component records a new commit whose projected `.comp.json` names the env's new version

#### Scenario: Installed package state is not captured

- **WHEN** a component is snapped in a workspace whose dependencies have not been installed
- **THEN** the snap succeeds and records only declared specifiers and recorded component versions

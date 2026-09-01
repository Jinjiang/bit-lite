## ADDED Requirements

### Requirement: Durable hidden component history store

Bit Lite SHALL keep component version history in a bare Git repository at `.bit-lite-store.git` under the workspace root. The history store SHALL be distinct from the disposable `.bit-lite` directory and from the workspace's source Git repository.

#### Scenario: Initialize the store on the first snap

- **WHEN** a user runs `bit-lite snap` in a workspace that has no component history store
- **THEN** Bit Lite initializes `.bit-lite-store.git` as a bare Git repository before recording the selected components
- **AND** it does not create or change a branch, commit, ref, index, or worktree in the workspace's source Git repository

#### Scenario: Preserve the durable store during cleanup

- **WHEN** generated `.bit-lite` state is cleaned or regenerated
- **THEN** `.bit-lite-store.git` remains unchanged

#### Scenario: Git is unavailable

- **WHEN** a versioning command requires Git but a compatible Git executable is unavailable
- **THEN** the command fails with an actionable diagnostic and makes no visible component-history ref changes
- **AND** existing non-versioning commands remain usable

### Requirement: One linear history per component

Bit Lite SHALL maintain a distinct canonical ref for every component, using `refs/heads/components/<component-key>`, where `<component-key>` is a deterministic, reversible, collision-free encoding of the canonical component ID. A snap commit SHALL have the previous commit of the same component as its sole parent, or no parent for that component's first snap.

#### Scenario: Snap a component for the first time

- **WHEN** a selected component has no canonical history ref
- **THEN** Bit Lite creates a root commit containing that component's captured tree
- **AND** advances only that component's canonical history ref to the new commit

#### Scenario: Snap a component again

- **WHEN** a selected component already has a snap and its captured tree has changed
- **THEN** Bit Lite creates a commit whose sole parent is the component's current snap
- **AND** advances that component's canonical history ref to the new commit

#### Scenario: Snap independent components

- **WHEN** two components are snapped at different times
- **THEN** each component's commits are reachable from its own canonical history ref
- **AND** neither component's commits become parents of the other component's commits

#### Scenario: Report a snap identity

- **WHEN** Bit Lite records or reports a component snap
- **THEN** it exposes the commit object ID with its Git object algorithm, such as `sha1:<oid>` or `sha256:<oid>`

### Requirement: Complete deterministic component file capture

For v1, Bit Lite SHALL recursively capture every regular file owned by the component root, including source, docs, demos, tests, assets, dotfiles, and `.comp.json`. The commit tree SHALL mirror paths relative to the component root and SHALL NOT introduce a wrapper directory or Bit Lite-generated manifest.

Bit Lite SHALL prune `.git`, `.bit`, `.bit-lite`, `.bit-lite-store.git`, `node_modules`, `dist`, `build`, and `coverage` directories at any depth. It SHALL preserve file bytes and executable-file mode without applying Git clean or smudge filters. Empty directories SHALL have no representation because Git trees contain files rather than directories.

#### Scenario: Capture all component-owned file categories

- **WHEN** a component contains implementation files, documentation, demos, tests, assets, dotfiles, and `.comp.json`
- **THEN** the snap tree contains each regular file at the same component-relative path with the same bytes

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

#### Scenario: Snap selected components

- **WHEN** a user supplies component filters to `bit-lite snap`
- **THEN** Bit Lite captures only matching registered components
- **AND** reports an error when no registered component matches

#### Scenario: Snap all workspace components

- **WHEN** a user runs `bit-lite snap` without component filters
- **THEN** Bit Lite attempts to capture every registered component as one local operation

### Requirement: Content-aware and atomic snap publication

Bit Lite SHALL compare a selected component's captured tree with the tree of its current snap. An unchanged tree SHALL NOT create a commit. When one command records multiple changed components, their canonical refs SHALL be published as one transactional local ref update after all trees and commits are successfully prepared.

#### Scenario: Component content is unchanged

- **WHEN** a component's captured tree is identical to the tree at its canonical history ref
- **THEN** Bit Lite reports the component as unchanged
- **AND** creates no new commit and does not move the component ref

#### Scenario: One selected component cannot be captured

- **WHEN** any selected component fails validation or object preparation before ref publication
- **THEN** no selected component canonical history ref is advanced
- **AND** any newly written but unreachable Git objects may be left for normal Git garbage collection

#### Scenario: Concurrent ref movement

- **WHEN** a selected component's canonical ref changes after Bit Lite reads it but before publication
- **THEN** the transactional ref update fails instead of overwriting the concurrent snap

### Requirement: Explicit v1 snapshot boundary

V1 component snaps SHALL derive versioned content only from the captured component directory. Bit Lite SHALL NOT implicitly add workspace-level configuration, dependency inference, resolved environment state, package-manager state, build artifacts, caches, or generated output to the component commit.

#### Scenario: Workspace policy changes without component file changes

- **WHEN** only `bit-lite.json`, inferred dependencies, or resolved environment state changes outside the component directory
- **THEN** the next snap reports that component as unchanged

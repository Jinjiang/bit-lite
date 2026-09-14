## MODIFIED Requirements

### Requirement: Durable hidden component history store

Bit Lite SHALL keep component version history in a bare Git repository using the reftable ref backend at `.bit-lite-store.git` under the workspace root. The history store SHALL be distinct from the disposable `.bit-lite` directory and from the workspace's source Git repository. Bit Lite SHALL explicitly select reftable when initializing a local store and SHALL NOT fall back to another ref backend. Commands that open or create the store SHALL require a Git executable with reftable support.

#### Scenario: Initialize the store on the first snap

- **WHEN** a user runs `bit-lite snap` in a workspace that has no component history store
- **THEN** Bit Lite initializes `.bit-lite-store.git` as a bare Git repository using reftable before recording the selected components, regardless of Git's configured default ref backend
- **AND** it does not create or change a branch, commit, ref, index, or worktree in the workspace's source Git repository

#### Scenario: Preserve the durable store during cleanup

- **WHEN** generated `.bit-lite` state is cleaned or regenerated
- **THEN** `.bit-lite-store.git` remains unchanged

#### Scenario: Git is unavailable

- **WHEN** a versioning command requires Git but a compatible Git executable is unavailable
- **THEN** the command fails with an actionable diagnostic and makes no visible component-history ref changes
- **AND** existing non-versioning commands remain usable

#### Scenario: Git does not support reftable initialization

- **WHEN** the Git executable rejects initialization with the reftable ref backend
- **THEN** Bit Lite reports the requirement for Git 2.45 or newer with reftable support and includes the original Git error
- **AND** it does not initialize a `files` store or publish component-history refs

#### Scenario: Open an existing unsupported local store

- **WHEN** a mutable or read-only history operation opens an existing local store whose ref backend is not reftable
- **THEN** Bit Lite fails with an explicit unsupported-format diagnostic
- **AND** it does not migrate, reinitialize, or modify that store

### Requirement: One linear history per component

Bit Lite SHALL maintain a distinct canonical ref for every component, using `refs/heads/components/<component-key>`, where `<component-key>` is the canonical component ID encoded as unpadded base64url. The encoding SHALL remain deterministic, reversible, and collision-free, and keys differing only in letter case SHALL identify distinct refs even on case-insensitive filesystems. A snap commit SHALL have the previous commit of the same component as its sole parent, or no parent for that component's first snap.

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

#### Scenario: Snap components whose encoded keys differ only in case

- **WHEN** components with case-distinct encoded keys are snapped sequentially or in one batch
- **THEN** each component has its own canonical ref and first snap without a parent
- **AND** subsequent snaps advance only their matching component history

#### Scenario: Report a snap identity

- **WHEN** Bit Lite records or reports a component snap
- **THEN** it exposes the commit object ID with its Git object algorithm, such as `sha1:<oid>` or `sha256:<oid>`

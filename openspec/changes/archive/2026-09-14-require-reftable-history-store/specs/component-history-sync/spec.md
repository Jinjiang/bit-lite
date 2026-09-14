## MODIFIED Requirements

### Requirement: Dedicated component-history remote

Bit Lite SHALL synchronize the hidden component history repository with a Git remote configured as `origin` inside that repository. Remote configuration and synchronization SHALL be independent of the workspace source repository and its remotes. The local reftable requirement SHALL NOT restrict the remote's ref backend: Bit Lite SHALL support synchronization with both `files` and reftable remotes when the remote can represent the exchanged refs.

#### Scenario: Configure the remote on first sync

- **WHEN** a user runs `bit-lite sync --remote <url>` and the component history store has no `origin`
- **THEN** Bit Lite configures that URL as the store's `origin` and begins synchronization
- **AND** does not add or modify a remote in the workspace source repository

#### Scenario: Reuse the configured remote

- **WHEN** a user runs `bit-lite sync` after `origin` has been configured
- **THEN** Bit Lite synchronizes with the stored component-history remote URL

#### Scenario: Prevent accidental remote replacement

- **WHEN** `origin` is already configured and `bit-lite sync --remote <different-url>` is requested
- **THEN** Bit Lite fails with an explicit remote-mismatch error
- **AND** leaves the configured URL and all canonical refs unchanged

#### Scenario: Synchronize across different ref backends

- **WHEN** a local reftable store synchronizes with a compatible remote using `files` or reftable
- **THEN** component heads and annotated tags can be published and imported through the existing Git synchronization protocol
- **AND** neither repository's ref backend is changed

### Requirement: Fetch into private tracking refs before reconciliation

Bit Lite SHALL fetch remote component heads and component tags into private remote-tracking refs under `refs/bit-lite/remotes/origin/` before reconciling them with canonical local heads and tags. Fetching SHALL NOT directly overwrite canonical local refs. Tracking refs whose component keys differ only in letter case SHALL remain distinct, including on case-insensitive local filesystems.

#### Scenario: Fetch remote history

- **WHEN** the remote contains component heads or component tags
- **THEN** Bit Lite fetches their objects and records their advertised values in private tracking refs
- **AND** canonical refs remain unchanged until reconciliation validation succeeds

#### Scenario: Fetch case-distinct component heads and tags

- **WHEN** the remote advertises heads and tags for components whose encoded keys differ only in letter case
- **THEN** Bit Lite preserves each advertised head and tag in its matching private tracking ref
- **AND** successful reconciliation preserves the separate component histories and tag targets in canonical local refs

#### Scenario: Remote ref is invalid

- **WHEN** a fetched component ref has an invalid name, object type, history shape, or tag target
- **THEN** synchronization fails before updating canonical local refs or publishing local refs

## Purpose

Define how Bit Lite safely exchanges component histories and immutable version tags with a dedicated Git remote while preserving local and remote changes.

## Requirements

### Requirement: Dedicated component-history remote

Bit Lite SHALL synchronize the hidden component history repository with a Git remote configured as `origin` inside that repository. Remote configuration and synchronization SHALL be independent of the workspace source repository and its remotes.

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

### Requirement: Fetch into private tracking refs before reconciliation

Bit Lite SHALL fetch remote component heads and component tags into private remote-tracking refs under `refs/bit-lite/remotes/origin/` before reconciling them with canonical local heads and tags. Fetching SHALL NOT directly overwrite canonical local refs.

#### Scenario: Fetch remote history

- **WHEN** the remote contains component heads or component tags
- **THEN** Bit Lite fetches their objects and records their advertised values in private tracking refs
- **AND** canonical refs remain unchanged until reconciliation validation succeeds

#### Scenario: Remote ref is invalid

- **WHEN** a fetched component ref has an invalid name, object type, history shape, or tag target
- **THEN** synchronization fails before updating canonical local refs or publishing local refs

### Requirement: Fast-forward-only component reconciliation

For each component, Bit Lite SHALL reconcile local and remote heads using ancestry rather than timestamps. Equal heads SHALL remain unchanged; a missing side or strict ancestor SHALL be advanced to the descendant. Divergent heads SHALL be a hard conflict in v1 and SHALL never be merged or force-updated automatically.

#### Scenario: Remote component is new locally

- **WHEN** a valid component history exists only on the remote
- **THEN** Bit Lite creates the canonical local component ref at the fetched remote head

#### Scenario: Local component is new remotely

- **WHEN** a valid component history exists only locally
- **THEN** Bit Lite schedules that component ref for publication to the remote

#### Scenario: Remote history is ahead

- **WHEN** the local component head is a strict ancestor of the fetched remote head
- **THEN** Bit Lite fast-forwards the canonical local component ref to the remote head

#### Scenario: Local history is ahead

- **WHEN** the fetched remote component head is a strict ancestor of the local head
- **THEN** Bit Lite schedules the local component ref for fast-forward publication

#### Scenario: Component histories diverge

- **WHEN** neither the local nor fetched remote component head is an ancestor of the other
- **THEN** synchronization reports a conflict for that component
- **AND** does not merge, rebase, force-update, publish, or change any canonical local ref in that synchronization operation

### Requirement: Immutable tag reconciliation

Bit Lite SHALL reconcile component tags by immutable name and peeled snap target. A tag present on only one side SHALL be copied to the other side after validation. Equal tags SHALL be unchanged. The same component version resolving to different snaps SHALL be a hard conflict.

#### Scenario: Publish a local-only tag

- **WHEN** a valid component tag exists only locally
- **THEN** Bit Lite schedules the annotated tag ref and its target objects for publication

#### Scenario: Import a remote-only tag

- **WHEN** a valid component tag exists only in remote tracking refs
- **THEN** Bit Lite creates the canonical local annotated tag ref with the fetched tag object

#### Scenario: Tag targets conflict

- **WHEN** the same component version exists locally and remotely but peels to different snap commits
- **THEN** synchronization reports an immutable-tag conflict
- **AND** does not change canonical refs or publish refs in that synchronization operation

### Requirement: Atomic synchronization publication

Bit Lite SHALL validate all fetched and local component refs before changing canonical local refs or publishing refs. Multiple canonical local updates SHALL use one Git ref transaction. Multiple remote ref updates SHALL use Git atomic push and SHALL fail without a non-atomic fallback when the remote does not support atomic push. Bit Lite SHALL never use force push for v1 synchronization.

#### Scenario: Validation succeeds for multiple components

- **WHEN** synchronization requires multiple local canonical updates
- **THEN** Bit Lite applies all of them in one local ref transaction with expected-old-value checks

#### Scenario: Publish multiple refs

- **WHEN** synchronization needs to publish more than one component head or tag
- **THEN** Bit Lite requests an atomic Git push for the complete ref set

#### Scenario: Remote lacks atomic push support

- **WHEN** a multi-ref publication is required and the remote rejects atomic push as unsupported
- **THEN** synchronization fails with an actionable diagnostic
- **AND** does not retry as separate non-atomic pushes

#### Scenario: Remote changes during synchronization

- **WHEN** a remote ref changes after fetch and causes the non-forced push to be rejected
- **THEN** synchronization fails and asks the user to synchronize again
- **AND** does not overwrite the remote change

### Requirement: Synchronization reports component outcomes

The `sync` command SHALL report per-component and per-tag outcomes, including unchanged, imported, published, fast-forwarded, and conflicted states. A conflict or publication failure SHALL produce a non-zero exit status.

#### Scenario: Synchronization is already up to date

- **WHEN** all canonical local heads and tags equal their fetched remote counterparts
- **THEN** Bit Lite reports the store as up to date
- **AND** does not issue a push

## Why

Git's `files` ref backend can alias distinct base64url component keys on case-insensitive filesystems, causing snaps or fetched tracking refs to mix component histories. The project has no deployed stores to preserve, so adopting reftable now removes this correctness risk without a migration path.

## What Changes

- **BREAKING**: Require reftable for every local component history store; initialize it explicitly and reject existing stores with another ref backend.
- Require Git 2.45 or newer with reftable support for commands that open or create a history store, with an actionable diagnostic when the requirement is unmet.
- Keep existing component IDs, base64url ref keys, object formats, and synchronization refspecs.
- Preserve independent snap histories, heads, tags, and tracking refs for component keys that differ only by letter case.
- Continue synchronizing with compatible Git remotes regardless of their ref backend.
- Document the prerequisite and add regression coverage for initialization, unsupported stores, snap isolation, and synchronization.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `component-snapshot-history`: Require reftable local stores and explicit compatibility diagnostics, and guarantee isolation of case-distinct ref keys.
- `component-history-sync`: Preserve case-distinct fetched heads and tags, and support synchronization between different local and remote ref backends.

## Impact

Changes are confined to the history package's store lifecycle, history regression tests, and repository documentation. There is no new package dependency, ref encoding change, legacy-store migration, or change to commands that do not use component history.

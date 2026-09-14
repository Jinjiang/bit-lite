## Context

The history package stores unpadded base64url component keys in Git refs. Distinct IDs such as `aaa` and `aaG` encode to keys differing only in letter case. With Git's filesystem-backed refs on a case-insensitive filesystem, reading a head can return another component's head before the expected-old-value transaction is prepared, and fetching can overwrite another component's tracking ref. Existing transactional checks cannot repair that earlier aliasing.

The project has no deployed component stores to preserve. Git CLI operations already own all history storage access, and reftable keeps ref names independent of filesystem case handling.

## Goals / Non-Goals

**Goals:**

- Guarantee independent local component refs and histories on supported filesystems.
- Make the required Git capability and local storage backend explicit.
- Keep read-only history access read-only and preserve interoperability with Git remotes.

**Non-Goals:**

- Migrate or continue supporting existing local `files` stores.
- Change component ID encoding, Git object formats, or the history wire protocol.
- Add performance benchmarks or ref maintenance commands.

## Decisions

### Initialize local stores explicitly with reftable

Add `--ref-format=reftable` to the existing bare Git initialization. This overrides global default-ref-format configuration and exercises the required capability at the moment it is needed. If initialization fails, report that component versioning requires Git 2.45 or newer with reftable support and include the original Git failure so unrelated initialization errors remain diagnosable. Do not retry with `files`.

A version-string check would not demonstrate the installed executable's capability. A separate temporary-repository probe on each open would add writes to read-only access and duplicate normal initialization, so neither is needed.

### Enforce the backend when opening an existing local store

The shared existing-store validation uses `git rev-parse --show-ref-format` to check that the bare repository uses reftable before returning a history store. A `files` store is rejected with an explicit unsupported-format diagnostic; it is not migrated, deleted, or reinitialized. Both mutable and read-only opens use this validation. If Git cannot read the repository, preserve its error and include the compatible-Git requirement, since older Git can reject the reftable extension before format inspection. A missing store still produces no writes when opened for inspection.

### Preserve the ref namespace and remote interoperability

Keep base64url keys and current refspecs unchanged. Reftable provides exact ref-name storage locally, including canonical heads, tags, and private fetched refs. The remote's backend is outside the local-store contract: sync continues to use normal Git fetch and push, which can exchange refs between `files` and reftable repositories. A remote must itself be able to represent the advertised refs.

Changing the encoding would spread changes across every ref consumer and still require a compatibility decision. Supporting both local backends would retain the correctness risk on case-insensitive filesystems.

### Test observable isolation and storage requirements

Test that initialization uses reftable even when Git defaults to `files`, that unsupported Git initialization produces useful diagnostics, and that existing `files` stores are rejected without modification. Exercise components whose encoded keys differ only in case through sequential and batch snaps and through sync of heads and tags, checking independent commits and ref targets. Run sync coverage against both remote backends.

## Risks / Trade-offs

- [Older Git installations cannot use component history] → Document Git 2.45+ with reftable support and return an actionable diagnostic; non-history commands remain independent of Git.
- [Pre-change experimental stores become unsupported] → Fail explicitly on open without modifying them. No migration is included because there are no deployed stores to retain.
- [A `files` remote on a case-insensitive filesystem cannot hold case-distinct refs] → Cover ordinary cross-backend sync separately from colliding-key sync, and use a reftable remote for the latter. The local guarantee cannot fix the remote's own storage limitation.

## Migration Plan

Ship the new store initialization and validation together with documentation and regressions. Existing local `files` stores are outside the supported format; opening them leaves their contents intact and reports the requirement. No automatic conversion or destructive reset is performed.

## Open Questions

None.

## 1. History Package and Git Foundation

- [ ] 1.1 Create the `bit-lite-history` workspace package with TypeScript, Vitest, public domain types/results, and a dependency from the `bit-lite` CLI package.
- [ ] 1.2 Implement a shell-free Git process adapter that uses argument arrays, explicit `--git-dir`, bounded output, structured errors, and isolated operation-specific environment overrides.
- [ ] 1.3 Implement store discovery and lazy bare initialization at `<workspace>/.bit-lite-store.git`, including Git availability, repository-shape, and object-format checks.
- [ ] 1.4 Implement algorithm-qualified object ID parsing and formatting without assuming SHA-1.
- [ ] 1.5 Implement reversible base64url component-key encoding and validated builders/parsers for canonical head, tag, and private tracking refs.
- [ ] 1.6 Add unit and real-Git tests for initialization, malformed stores, missing Git diagnostics, object formats supported by the installed Git, component-key round trips, and ref-injection rejection.

## 2. Deterministic Component Snapshots

- [ ] 2.1 Implement a confined `lstat`-based component tree walker with stable path ordering, exact v1 directory pruning, regular/executable file modes, and component-relative error paths.
- [ ] 2.2 Reject symbolic links without traversal and add fixture tests covering internal links, external links, nested links, and links hidden beneath pruned directories.
- [ ] 2.3 Implement filter-free blob writing and deterministic Git tree construction through batched plumbing and an operation-scoped temporary index.
- [ ] 2.4 Implement component commit creation and inspection, enforcing zero-or-one-parent linear history and same-component parentage.
- [ ] 2.5 Implement tree-ID no-op detection so unchanged components create neither commits nor ref movement.
- [ ] 2.6 Implement multi-component snap preparation followed by one expected-old-value `update-ref` transaction, leaving all canonical refs unchanged on validation, preparation, or concurrency failure.
- [ ] 2.7 Add real-Git integration tests for complete capture of source/docs/demos/tests/assets/dotfiles/`.comp.json`, exact bytes and modes, exclusions, root and subsequent commits, independent histories, unchanged snaps, all-or-nothing multi-component updates, and concurrent ref movement.

## 3. Snap Command Integration

- [ ] 3.1 Add a `snap` command that loads the existing workspace model, applies repeated `--filter` component patterns, defaults to all registered components, and rejects an empty selection.
- [ ] 3.2 Add structured snap reporting for changed and unchanged components with canonical IDs and algorithm-qualified snap IDs.
- [ ] 3.3 Register `snap` in the CLI and usage text without initializing or requiring the history store for existing non-versioning commands.
- [ ] 3.4 Add CLI tests for selection, output, non-zero failures, Git-unavailable behavior, and proof that source-repository refs, index, worktree, config, and remotes are untouched.

## 4. Immutable Component Tags

- [ ] 4.1 Add a maintained semantic-version dependency with pnpm and implement strict version validation for component tags.
- [ ] 4.2 Implement annotated tag creation at component-prefixed refs, requiring the current component snap and validating target reachability from the matching component head.
- [ ] 4.3 Implement same-target idempotency and different-target immutable conflict behavior without force, move, or delete paths.
- [ ] 4.4 Add and register `tag --filter <component-pattern> --version <semver>` with exact-one-component validation and structured output.
- [ ] 4.5 Add unit and real-Git integration tests for valid annotated tags, missing snaps, invalid versions, ambiguous selection, repeat operations, reassignment conflicts, malformed tags, and cross-component targets.

## 5. Remote History Synchronization

- [ ] 5.1 Implement internal-store `origin` configuration, first-sync `--remote` setup, stored-remote reuse, and explicit rejection of accidental remote replacement.
- [ ] 5.2 Implement explicit fetch refspecs that map remote component heads and tags into private tracking refs without directly changing canonical refs.
- [ ] 5.3 Implement full local/fetched ref validation for naming, object types, linear component history, decoded ownership, annotated tag structure, and tag reachability.
- [ ] 5.4 Implement ancestry-based head reconciliation for equal, local-only, remote-only, local-ahead, remote-ahead, and divergent histories.
- [ ] 5.5 Implement immutable tag reconciliation for equal, local-only, remote-only, and conflicting peeled targets.
- [ ] 5.6 Implement sync planning that reports all validation/conflict outcomes before one expected-old-value local ref transaction and before any remote publication.
- [ ] 5.7 Implement non-forced explicit publication refspecs, require `--atomic` for multi-ref pushes, and reject unsupported atomic publication without a non-atomic fallback.
- [ ] 5.8 Add and register `sync [--remote <url>]` with per-component/tag imported, published, fast-forwarded, unchanged, and conflicted reporting plus correct exit status.
- [ ] 5.9 Add real local-bare-remote integration tests for initial publish/import, stored remote reuse, bidirectional fast-forwards, idempotency, independent components, immutable tags, divergence, concurrent remote movement, and source-remote isolation.
- [ ] 5.10 Add adapter-level tests for malformed fetched refs, atomic-push rejection, no force push, no push after validation failure, and no non-atomic multi-ref fallback.

## 6. Durable Store Conventions and Documentation

- [ ] 6.1 Add `.bit-lite-store.git/` to relevant source ignore files and update demo cleanup scripts so they remove disposable `.bit-lite` state without deleting durable component history.
- [ ] 6.2 Document the snap capture boundary, fixed exclusions, symlink rejection, commit-versus-tree identity, immutable tags, remote configuration, conflict behavior, backup responsibility, and manual-store warning.
- [ ] 6.3 Add regression tests proving existing compile, install, link, preview, start, test, and watch command paths neither require Git nor create/open the component history store.
- [ ] 6.4 Run package and workspace Vitest suites, typechecking, and builds with pnpm, and resolve every failure introduced by the change.

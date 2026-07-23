## Context

The workspace currently repeats small top-level helpers across ten production packages. Some families are byte-for-byte equivalent, while others share a name but intentionally differ in accepted input, error construction, recursion, or output detail. The selected scope covers 28 function families, including the side-chat decisions to unify all host and port readers and to make `bit-lite-vendors` the owner of `isVendorDefinition`.

The latest `codex/simplify-watch-shutdown-lifecycle` change at `c84c6a3` removes all five production `isShutdownMessage` helpers and the public `RunnerShutdownMessage` type, keeping worker shutdown private behind the single `isWorkerRunnerShutdownMessage` protocol predicate. The same change introduces four production `throwCombinedErrors` helpers with two policies: two retain duplicate error objects and two deduplicate them before throwing. The utility scope therefore replaces `isShutdownMessage` with `throwCombinedErrors` and treats `c84c6a3` as an implementation baseline.

The new shared package must sit below its consumers in the dependency graph. It must also remain usable by browser code such as `bit-lite-preview/browser`, so importing browser-safe utilities cannot load Node built-ins. Several current predicates use types owned by `bit-lite-vendors`; structural utility types are required where appropriate to prevent a `bit-lite-utils` → `bit-lite-vendors` → `bit-lite-utils` cycle.

## Goals / Non-Goals

**Goals:**

- Add a private, dependency-light `bit-lite-utils` workspace package with explicit browser-safe and Node-specific entry points.
- Provide canonical implementations for the 27 selected generic utility families and a canonical `isVendorDefinition` in `bit-lite-vendors`.
- Preserve every selected production call site's observable behavior, including accepted input, return values, error classes and messages, stack inclusion, recursion, ordering, and protocol type narrowing.
- Unify `readHost` with `readPreviewHost`, and `readPort` with `readPreviewPort`, without removing the existing preview exports.
- Remove the selected local production implementations after migration and verify the result with focused tests plus affected-package validation.

**Non-Goals:**

- Consolidating test-only helpers.
- Consolidating `compileOnce`.
- Consolidating or exporting the private `isWorkerRunnerShutdownMessage` worker-protocol predicate.
- Consolidating differently named duplicate functions other than `readPreviewHost` and `readPreviewPort`.
- Redesigning command behavior, vendor protocols, package-manifest semantics, preview routing, or filesystem discovery policy.
- Making `bit-lite-utils` a public npm package.

## Decisions

### 1. Use two utility entry points and no internal runtime dependencies

`packages/bit-lite-utils` will follow the repository's ESM/TypeScript package conventions and expose:

- `bit-lite-utils`: browser-safe utilities that do not import Node built-ins.
- `bit-lite-utils/node`: utilities that import or operate directly on Node process, filesystem, path, networking, or HTTP APIs.

The root entry will contain `isRecord`, `isJsonObject`, `isJsonValue`, `sanitizeFileName`, `createComponentFileMap`, `formatExitCode`, `isFileUrl`, `readStringRecord`, `sortStringRecord`, `throwCombinedErrors`, `formatError`, `readHost`, `readPort`, `escapeHtml`, `isPortUnavailableError`, `readDefaultExport`, and `readPackageName`.

The Node entry will contain `isInteractiveTerminal`, `isNodeErrorCode`, `isFile`, `listen`, `normalizeFilePath`, `replaceExtension`, `toPosixPath`, `collectFiles`, `readJsonFile`, and `sendHtml`.

`bit-lite-utils` will have no workspace runtime dependencies. Generic structural types and callbacks will be used instead of importing consumer-owned error classes, JSON types, server subclasses, compiler result types, or vendor protocol types.

Alternative considered: expose every utility from one root index. This was rejected because the browser preview entry could then accidentally pull Node built-ins into a browser bundle.

### 2. Keep vendor-domain validation in `bit-lite-vendors`

`isVendorDefinition` will be implemented once in `bit-lite-vendors` and exported from that package. `bit-lite-compiler` and the vendor task loader will consume the same predicate.

Alternative considered: place the predicate in `bit-lite-utils`. This was rejected because `VendorDefinition` is owned by `bit-lite-vendors`, and importing the owner from the foundational utility package would create a dependency cycle or force duplicated domain types.

### 3. Preserve exact helpers directly and make divergent policies explicit

Equivalent implementations will become direct shared functions. This applies to the exact or semantically equivalent families such as `isRecord`, `isInteractiveTerminal`, `isNodeErrorCode`, `sanitizeFileName`, `createComponentFileMap`, `formatExitCode`, `isFile`, `isFileUrl`, `listen`, `normalizeFilePath`, `readStringRecord`, `replaceExtension`, `sortStringRecord`, `toPosixPath`, `escapeHtml`, and `sendHtml`.

Families with real behavioral differences will use typed options, overloads, callbacks, or separately named policies within the shared implementation:

- `formatError` will explicitly select message-only, stack-preferred, and object-message-aware behavior.
- `throwCombinedErrors` will explicitly select whether repeated references to the same error object are retained or deduplicated before single-error passthrough or `AggregateError` construction.
- `isJsonValue` and `isJsonObject` will share recursive validation and explicitly select whether non-finite numbers are accepted. Finite-number JSON remains the default.
- `collectFiles` will expose traversal options for ignored directories, missing-directory handling, symlink traversal, result ordering, and traversal strategy needed by the three current consumers.
- `readPort` will support each current accepted input set, optional fallback, valid port bounds, contextual labels, and caller-provided error construction.
- `isPortUnavailableError` will explicitly select code-only matching or recursive code/message/cause matching.
- `readDefaultExport` will centralize package export-condition resolution while allowing each caller to construct its current missing-export error.
- `readJsonFile` will centralize UTF-8 reading and parsing while allowing consumer-specific read-error and parse-error mapping.
- `readPackageName` will accept an explicit validation policy and error factory so both current npm-name policies and error classes remain unchanged.

Alternative considered: choose one existing variant as the universal behavior. This was rejected because it would silently change diagnostics, JSON acceptance, traversal ordering, or recovery behavior.

### 4. Unify host and port readers while retaining compatibility exports

One canonical `readHost` will validate optional host input, apply a supplied fallback, and use caller-provided error construction. One canonical `readPort` will handle both CLI scalar input and runtime numeric assertions through explicit options.

The existing exported `readPreviewHost` and `readPreviewPort` APIs will remain available with their current signatures and behavior, but will delegate to the canonical utilities. Local `readHost` and `readPort` wrappers will be removed or replaced with direct calls as appropriate.

Alternative considered: remove or rename the preview exports. This was rejected because the refactor is intended to be behavior preserving and those exports may already be consumed.

### 5. Use generic structural signatures for consumer-owned data

`createComponentFileMap` will be generic over targets and result values and accept a path normalizer rather than importing demo-vendor result types. `formatExitCode` will accept the structural `number | null | undefined` domain rather than importing `RunnerExitCode`. `throwCombinedErrors` will accept `unknown[]` plus an explicit deduplication policy without importing lifecycle or command types.

This keeps `bit-lite-utils` reusable without making it a second owner of vendor, compiler, preview, or context domain models.

### 6. Migrate in dependency-safe groups

Implementation will proceed in this order:

1. Integrate `c84c6a3` from `codex/simplify-watch-shutdown-lifecycle` into the implementation worktree and resolve planning assumptions against that source baseline.
2. Scaffold `bit-lite-utils`, its exports, TypeScript configuration, and focused tests.
3. Add exact browser-safe utilities, then exact Node utilities.
4. Add and test explicit variant policies.
5. Export canonical `isVendorDefinition` from `bit-lite-vendors`.
6. Migrate foundational packages first, followed by higher-level `bit-lite` and demo packages.
7. Remove selected local implementations and use a source scan to confirm no selected production duplicates remain outside their canonical owner or compatibility wrappers.
8. Run package tests, typechecks, builds, and workspace-level validation with pnpm.

Rollback is a normal Git revert: restore local functions and remove the new workspace dependencies and package. No persistent data migration or deployment sequencing is involved.

## Risks / Trade-offs

- [Risk] A shared entry accidentally imports a Node built-in and breaks browser preview bundling. → Keep Node code behind `bit-lite-utils/node` and add a browser-safety test or import-graph assertion for the root entry.
- [Risk] Parameterizing divergent helpers creates an overly generic API. → Model only behavior already required by selected consumers and cover every policy with direct tests.
- [Risk] Error classes or exact messages change during migration. → Allow caller-provided error factories and add regression assertions before removing local helpers.
- [Risk] Utility imports introduce dependency cycles. → Keep `bit-lite-utils` free of workspace runtime dependencies and keep `isVendorDefinition` in `bit-lite-vendors`.
- [Risk] Public preview readers change or disappear. → Retain `readPreviewHost` and `readPreviewPort` as compatibility delegates with their existing signatures.
- [Risk] Implementing from the pre-lifecycle base reintroduces removed shutdown-message APIs or conflicts with the new aggregate cleanup paths. → Integrate `c84c6a3` before implementation, keep `isWorkerRunnerShutdownMessage` private, and migrate the four post-change `throwCombinedErrors` call sites.
- [Risk] A large cross-package migration makes failures hard to isolate. → Migrate by utility family and package layer, running targeted typechecks and tests after each group.

## 1. Canonical base Workspace

- [x] 1.1 Add JSON-safe `Workspace` and `WorkspaceComponent` types that contain normalized workspace config, canonical component/package facts, dependency records, entry paths, and configured env package references.
- [x] 1.2 Implement `readWorkspace()` so it builds one deterministic canonical component array without loading installed env packages or resolving env inheritance.
- [x] 1.3 Replace public component-registry maps with private lookup indexes and helpers that always return the original canonical component objects.
- [x] 1.4 Add base-workspace tests for missing external env installations, deterministic component ordering, canonical object reuse, and structured-clone/JSON serialization.
- [x] 1.5 Migrate install, link, dependency-project generation, and fixed local env materialization to consume the base `Workspace` without resolving service definitions.

## 2. Parent-only WorkspaceContext

- [x] 2.1 Define composed `PackageLocation`, `ResolvedService`, `EnvContext`, `ComponentContext`, and `WorkspaceContext` types without duplicating base workspace config or component fields.
- [x] 2.2 Refactor env loading so each selected env has one structured identity and inherited services retain the package location that declared them.
- [x] 2.3 Implement `resolveWorkspace(workspace)` with per-package env caching and canonical component references, using the already-read base workspace rather than reconstructing a registry.
- [x] 2.4 Implement derived component selection, dependency ordering, unique-env lookup, and env-grouping helpers without exposing maps or permanently stored groups.
- [x] 2.5 Add tests for child-env inheritance, declaring-service origin, shared-env cache reuse, filtered grouping, and absence of duplicated `config`, `envs`, and `groups` fields.
- [x] 2.6 Migrate workspace preparation and command setup to the explicit `readWorkspace` then install/link/materialize then `resolveWorkspace` lifecycle.

## 3. Stable vendor boundary

- [x] 3.1 Add the version-1, read-only, JSON-safe `VendorContext` contract containing base workspace, complete parsed arguments, selected env identity, service name, and declaring package location.
- [x] 3.2 Change common `VendorData` to `{ context, components, config, runtime? }`, using canonical `WorkspaceComponent` objects and command-specific generic config/runtime types.
- [x] 3.3 Add a parent-side context factory that derives `VendorContext` from one resolved env group and effective service without copying or mutating service definitions.
- [x] 3.4 Separate immutable resolved-service facts from command-prepared config so commands no longer clone a service solely to rewrite config fields.
- [x] 3.5 Refactor vendor task creation to accept the canonical resolved vendor module URL plus `VendorContext` and active data, and remove the runtime dependency from `bit-lite-vendors` to workspace/env module-resolution code.
- [x] 3.6 Provide or relocate a pure service-origin specifier helper that depends only on serializable package location, specifier, and base workspace root for vendor-owned config extensions.
- [x] 3.7 Add inline and worker runner contract tests proving the same context crosses structured-clone boundaries without maps, callbacks, loaded modules, caches, or parent-only `WorkspaceContext` data.
- [x] 3.8 Add a representative large-workspace transport test that verifies context serialization remains valid and does not duplicate resolved env graphs.

## 4. Produced-data-only results

- [x] 4.1 Define parent-owned task result wrappers that retain the original vendor context and validated vendor definition while storing vendor output only as produced data.
- [x] 4.2 Refactor command output validators to validate required produced fields and preserve additional JSON-safe vendor fields without reserving historical result field names.
- [x] 4.3 Update watch/result storage to derive env and vendor metadata from parent task state rather than vendor output.
- [x] 4.4 Update fixtures and contract tests for successful, invalid, and extensible vendor results, including opaque additional fields that use historical names.

## 5. Test service migration

- [x] 5.1 Build test vendor invocations from the resolved test service, shared `VendorContext`, selected canonical components, and effective tester config, removing `runtime.workspaceRoot`.
- [x] 5.2 Preserve complete raw/options/positional/passthrough arguments in test context while keeping parent-owned handling for watch and other lifecycle-affecting options.
- [x] 5.3 Update maintained Vitest, Jest, sample, and fixture testers to read workspace/args/env/origin facts from context and return produced test data without input echoes.
- [x] 5.4 Add a tester-extension test in which an unknown option such as coverage reaches the vendor and its additional JSON-safe output survives validation and storage without a command-side adapter.
- [x] 5.5 Preserve hard-coded vendor test-file discovery and add regression coverage for normal runs, watch events, mixed results, task failures, and result-store identity.

## 6. Preview service migration

- [x] 6.1 Build preview invocations with the shared context/data envelope while retaining the selected canonical components alongside command-prepared files, aliases, entries, HTML, and server runtime.
- [x] 6.2 Keep mounter, docs/template, discovery, route, and server preparation command-owned and resolve their module-bearing fields from the effective service origin before vendor startup.
- [x] 6.3 Update maintained Vite and Webpack preview vendors to consume prepared config/runtime and return only vendor-produced lifecycle/output data.
- [x] 6.4 Refactor preview task, proxy, and manifest state to derive selected env, vendor, and prepared server metadata from parent preparation/task context rather than vendor echoes.
- [x] 6.5 Add preview regression tests for prepared component preservation, inherited-service origin, ready/failed groups, public routes, proxy manifests, failure isolation, and cleanup.

## 7. Compile service migration

- [x] 7.1 Change compile invocation to use the shared `VendorContext`/`VendorData` envelope with one canonical component, opaque effective compile config, and compile-path runtime while retaining the short-lived compile entry.
- [x] 7.2 Update the maintained TypeScript compiler vendor to consume context/data and return only compiler-produced artifact information or no output on success.
- [x] 7.3 Refactor compile validation and presentation so component, env, service, and selected output paths come from parent orchestration rather than compiler echoes.
- [x] 7.4 Add compile regression tests for per-component compiler selection, dependency-layer ordering, inherited compiler origin, independent failures, and parent-owned identity/output-path derivation.

## 8. Cleanup, documentation, and verification

- [x] 8.1 Remove obsolete public `ComponentPackageRegistry`, `WorkspaceRuntime`, parallel component-ref/projection types, service-copy adapters, and conversion helpers after all consumers migrate.
- [x] 8.2 Update context, vendor, command, and demo documentation to explain the two workspace levels, versioned vendor context, argument ownership, declaring-service origin, active input fields, and produced-data-only outputs.
- [x] 8.3 Verify env-package behavior remains unchanged for external and `workspace:` envs, recursive `extends`, fixed env compilation/materialization, direct JSON exports, and inline generated vendor modules.
- [x] 8.4 Run focused context, vendor-runner, test, preview, compile, result-store, and demo-workspace suites and fix all regressions.
- [x] 8.5 Run the repository's existing build and static type validation, then execute demo end-to-end test and preview flows to confirm the migrated boundary is apply-ready.

## 1. Canonical Workspace and Component Registry

- [x] 1.1 Replace `bit-lite-context` workspace types with explicit component records containing required `path`, `id`, `packageName`, and `{ packageName, version }` env refs while preserving supported non-env metadata such as `defaultScope`.
- [x] 1.2 Implement one static workspace validator for npm names, supported version specs, duplicate component identities, same-env version conflicts, and targeted rejection of `envs`, `envName`, object-form components, aliases, defaults, and overrides.
- [x] 1.3 Extend `.comp.json` parsing with `kind: "component" | "env"`, default omitted kinds to ordinary components, and require a registered `workspace:` env target to have `kind: "env"`.
- [x] 1.4 Refactor the component package registry to consume the canonical workspace parser, retain component kinds and env refs, and derive internal env tooling edges separately from normal runtime dependency edges.
- [x] 1.5 Make env locality depend on the configured version and Bit registry: require `workspace:` targets in the registry, keep normal versions external even for same-named local or root pnpm packages, and remove pnpm-workspace membership as identity input.
- [x] 1.6 Add parser/registry tests for missing fields, deterministic ordering, duplicate identities, legacy forms, valid local env components, absent/non-env workspace targets, root pnpm packages outside the Bit registry, normal-version local-name collisions, and conflicting env versions.
- [x] 1.7 Update link, install, runtime, and service-command callers to use the shared registry records and errors rather than duplicate config readers or implicit package-name/env conversion.

## 2. Static JSON Env Definition Protocol

- [x] 2.1 Expand `bit-lite-env` service names and type maps to `test`, `preview`, and `compile`, retain typed known config fields, remove workspace `EnvConfig`/`ResolvedEnvConfig` and generic target types, and keep package-based `EnvDefinition.extends`.
- [x] 2.2 Remove `defineEnvFactory()`, factory context/types, and factory examples so the first-phase authoring contract is one static JSON `EnvDefinition` exported as the package default entry.
- [x] 2.3 Implement strict definition validation for exact package identity, one optional full-package-name parent, recursively JSON-safe top-level/service config, supported services, non-empty vendors, closed `vendor`/`config` service fields, and rejection of execution state plus generic `targets`/`files`/`patterns`.
- [x] 2.4 Keep compile service config opaque and vendor-specific so JSON validation permits different compiler vendors, inline TypeScript configurations, and unrelated config shapes without introducing a shared tsconfig schema.
- [x] 2.5 Extend `bit-lite-env` tests and README examples for valid JSON definitions, all three services, `extends`, whole-service replacement inputs, forbidden services/fields, generic target rejection, non-JSON values, and package-name mismatch errors.

## 3. Env Development Dependencies and Installation

- [x] 3.1 Derive a logical development dependency from every `component.env` ref without requiring duplication in `.comp.json.devDependencies`, and exclude ordinary components' env packages from generated runtime dependencies.
- [x] 3.2 Install normal-version external envs in each selecting component's development dependency context while allowing the package manager to deduplicate physical packages without changing logical ownership.
- [x] 3.3 Represent `workspace:` env refs as internal tooling links to registered env component packages and keep them separate from normal internal runtime dependencies.
- [x] 3.4 Validate explicit dev-dependency conflicts with `component.env`, preserve both uses-env and runtime dependency metadata when an env also `extends` the selected parent, and emit the runtime dependency once with a consistent version.
- [x] 3.5 Ensure normal-version env resolution starts from the component development context and cannot be shadowed by a same-named generated component or root pnpm workspace package.
- [x] 3.6 Add install/dependency-project tests for external env dev dependencies, local tooling links, dual-role parent dependencies, version conflicts, package-manager deduplication, missing installs, and external refs whose package names also exist locally.

## 4. Fixed Local Env Component Materialization

- [x] 4.1 Extend component main-entry detection and metadata validation so `kind: "env"` requires a JSON entry such as `index.json`, while ordinary component entry behavior remains unchanged.
- [x] 4.2 Add a Bit-lite-owned, non-configurable env component compiler that copies JSON/static files and transpiles env-owned TypeScript support files with fixed settings to matching JavaScript paths.
- [x] 4.3 Generate env component package manifests whose default `"."` export targets the emitted JSON entry such as `./dist/index.json`, while retaining the existing source symlink and dependency links.
- [x] 4.4 Materialize local env components before any env definition is loaded, order local env runtime dependencies deterministically, and make an env component a terminal boundary that never consults `services.compile`.
- [x] 4.5 Preserve source-relative output layout so `index.json` and an adjacent `webpack-react.ts` become adjacent `dist/index.json` and `dist/webpack-react.js` files addressable by one relative specifier.
- [x] 4.6 Add unit/integration tests for JSON-only envs, env-owned TypeScript config generation, generated exports, fixed compiler errors, ignored env compile services, local env dependency ordering, and clean-workspace materialization.

## 5. JSON Env Resolution, Loading, and Inheritance

- [x] 5.1 Implement an env package resolver that uses the selecting component context for external refs and the generated registered component package for local refs, resolves the public default entry, canonicalizes symlinks, and locates an unexported package manifest.
- [x] 5.2 Verify resolved manifest name and installed version against the configured ref, treat `workspace:` as registry identity rather than a literal version, and report every attempted dependency context on failure.
- [x] 5.3 Read and parse only JSON default entries without ESM JSON import attributes, validate the definition, and cache loading by canonical entry plus requested version for all matching components.
- [x] 5.4 Recursively resolve `EnvDefinition.extends` from the child env's normal dependencies, reject dev-only or undeclared parents, detect canonical-entry cycles, shallow-merge top-level config, and replace complete services rather than deep-merging them.
- [x] 5.5 Build loaded runtime groups under the selected child package identity while retaining package root, entry URL, entry directory, inheritance chain, and declaring-env origin for each effective service.
- [x] 5.6 Wrap materialization, resolution, file reading, JSON parsing, inheritance, identity, and validation failures with requested version, affected component IDs, failing phase, attempted origin, and original cause.
- [x] 5.7 Add loader fixtures/tests for external packages, generated local env components, root pnpm packages outside the Bit registry, same-name local/external packages, hidden manifests, malformed/non-JSON entries, caching, identity mismatch, multi-level inheritance, whole-service replacement, missing/dev-only parents, cycles, and partial-load aborts.

## 6. Origin-Aware Vendors, Test, and Preview

- [x] 6.1 Add a shared env specifier resolver that resolves relative module fields from the declaring JSON entry directory, prevents package-root escape, resolves package/subpath fields from the declaring env dependency context, supports documented workspace fallback, and reports attempted origins.
- [x] 6.2 Redesign parent-side vendor task input to carry selected env identity plus effective service declaring package/entry origin, while worker-facing data contains only JSON-safe env identity, selected components, config, args, and explicit command runtime.
- [x] 6.3 Resolve and validate vendors from the effective service's declaring env dependency context before workspace fallback, pass canonical vendor URLs to inline/worker runners, and retain selected-env/declaring-env/vendor context in errors.
- [x] 6.4 Migrate the test command to loaded JSON env services and narrowed vendor input while preserving component filtering, run/watch behavior, result storage, shutdown, and vendor-owned hard-coded test/spec discovery.
- [x] 6.5 Change preview preparation to resolve `configFile`, `mounter`, and `docsTemplate` from the effective service origin, including generated entry-relative modules and inherited parent services, before generating browser source or starting a vendor.
- [x] 6.6 Migrate preview vendor task creation without changing proxy routes, manifests, preparation-failure isolation, server lifecycle, cleanup ownership, or existing preview result contracts.
- [x] 6.7 Add vendor/test/preview tests for entry-relative generated config, exported dependency subpaths, inherited origins, workspace fallback, root escape, unresolved-field diagnostics, invalid vendor metadata, filtered multi-env inputs, unchanged vendor discovery, worker serialization, watch shutdown, and preview failure isolation.

## 7. Per-Component Ordinary Compile Service

- [x] 7.1 Replace the globally hard-coded ordinary-component compiler with lookup of each component's effective `services.compile`, preserving that component's selected env identity and the service's declaring-env origin.
- [x] 7.2 Compute ordinary runtime-dependency layers, invoke every ready component with its own compile vendor/config, permit different compiler vendors or TypeScript configs across one graph, and treat batching by identical env/service as an optional optimization only.
- [x] 7.3 Keep env components out of configurable compile execution, consume their fixed materialized packages as terminal dependencies, and prevent failures from re-entering an env-selected compiler cycle.
- [x] 7.4 Stop dependent later layers after missing services, invalid results, or vendor failures while allowing independent ready work to complete and report separately.
- [x] 7.5 Route `install --compile` through dependency installation, component linking, fixed env materialization, JSON env loading/inheritance, and then the ordinary per-component compile pipeline.
- [x] 7.6 Adapt maintained compile vendor inputs/results to the common structured vendor contract without imposing a shared compiler config schema.
- [x] 7.7 Add command tests for cross-env dependency layers, same vendor with different configs, different compiler vendors, inherited compile origins, missing services, invalid results, vendor failures, fixed env boundaries, filtered execution, and `install --compile` clean-start ordering.

## 8. Demo Env Packages and Workspace Migration

- [x] 8.1 Create independently resolvable external Node and Vue demo env packages whose default `"."` exports are JSON definitions, whose package manifests declare their vendor/tool/config dependencies, and which are not registered as components in `demo-workspace`.
- [x] 8.2 Add `packages/demo-workspace/components/envs/react` as a real `kind: "env"` Bit component with `index.json`, `.comp.json`, an explicit external Node env selection, and a normal Node env runtime dependency for `extends`.
- [x] 8.3 Define React env inheritance so its JSON extends Node by full package name, inherits at least one service, replaces at least one complete service, and retains all compile/test/preview config as JSON-safe data without env-owned files/patterns.
- [x] 8.4 Move `demo-config/src/previewers/webpack-react.ts` into the React env component, declare all of its runtime/tool/peer dependencies on the env package, and reference the generated `./webpack-react.js` from the React JSON preview config.
- [x] 8.5 Keep React mounter/docs-template references as exported `demo-config` subpaths and keep `demo-vendors` as the test/preview/compile implementation package so the fixture covers both entry-relative and dependency-export resolution.
- [x] 8.6 Replace `packages/demo-workspace/bit-lite.json` top-level envs and `envName` fields with normal-version Node/Vue env refs, a `workspace:*` React env ref, and a component record for the local React env itself.
- [x] 8.7 Update demo package manifests, `.comp.json` files, pnpm workspace metadata, generated dependency expectations, and the lockfile with `pnpm` so external/local env identities and dev/runtime roles are reproducible.
- [x] 8.8 Update `bit-lite`, `bit-lite-context`, `bit-lite-env`, demo package, and design-facing READMEs for JSON entry authoring, `kind: "env"`, registry-based locality, derived dev dependencies, inheritance dependencies, fixed env compilation, per-component compile behavior, and vendor-owned discovery.

## 9. Cleanup and Verification

- [x] 9.1 Remove dead inline workspace env definitions, alias inheritance, pattern assignment, workspace overrides, duplicate config readers, factory APIs/fixtures/messages, JSON-import assumptions, and the global hard-coded ordinary-component compiler path while retaining the fixed env component compiler.
- [x] 9.2 Use repository searches to confirm only intentional migration or alternative wording remains for `envs`, `envName`, env factories, root-pnpm locality, env target fields, and globally uniform compile behavior.
- [x] 9.3 Run focused `pnpm --filter` tests and existing typechecks for `bit-lite-env`, `bit-lite-context`, `bit-lite-vendors`, `bit-lite-preview`, `bit-lite`, demo env/config/vendor packages, and the local React env fixture, fixing contract or type regressions.
- [x] 9.4 Run demo end-to-end install/link plus test, preview preparation/startup, and cross-env compile, verifying clean env materialization, external/local resolution, inheritance, generated relative Webpack config, exported config subpaths, different compile configs, component filtering, fallback errors, vendor-owned discovery, and clean shutdown.
- [x] 9.5 Run repository-wide existing test, typecheck, and build suites and verify generated package manifests/artifacts contain JSON env entries, expected JavaScript support outputs, no stale inline-env schema, and no accidental runtime env dependency on ordinary components.

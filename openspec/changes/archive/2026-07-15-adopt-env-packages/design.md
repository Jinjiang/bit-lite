## Context

Bit-lite currently has two partially overlapping workspace models. `bit-lite-context` requires top-level `envs`, resolves alias-based `extends`, accepts pattern-to-env mappings, and groups components by `envName`; component package commands separately parse `bit-lite.json`, retain an optional `{ packageName, version }` env reference, and still translate legacy forms. The maintained demo therefore contains both models and points every component at `demo-config`, which is a configuration package rather than an env.

The component package registry already distinguishes internal component dependencies from external packages by version specifier: `workspace:` means a package must exist in the current Bit workspace registry, while a normal version remains external even if a same-named package exists elsewhere in the monorepo. Env assignment should use the same rule. Root pnpm-workspace membership is neither Bit component identity nor sufficient evidence that a package is a local env.

`bit-lite-env` has the beginnings of a JSON-safe service protocol, but test and preview still consume inline workspace definitions and compile selects one hard-coded TypeScript vendor for every component. Env packages cannot yet own relative configuration modules reliably. The change crosses configuration, component metadata, package installation and linking, env package materialization and loading, inheritance, three service commands, and maintained demo fixtures.

Every env is conceptually a component package. In a consuming workspace it has one of two forms: a registered local Bit component reached through `workspace:`, or an external package reached through a normal package-manager version. A local env component must be materialized before its JSON definition can be loaded, but asking that definition for its own compile service would create a bootstrap cycle. Bit-lite therefore needs one deliberately narrow built-in compiler for env components while retaining env-selected compile behavior for every ordinary component.

The first implementation migrates persisted assignment to package references and records both requested and installed versions in `LoadedEnvRuntime`, but several runtime and service boundaries still copy only `envName: string`. That string now contains the selected npm package name rather than an alias, duplicates data already present on the loaded runtime, and drops version provenance when vendor input, command results, preview state, and stored results cross package or worker boundaries.

## Goals / Non-Goals

**Goals:**

- Make an explicit npm package reference on each component the only env assignment mechanism and treat it as that component's logical development dependency.
- Use Bit component registry membership, together with `workspace:`, to distinguish local env components from external env packages.
- Load and validate one JSON `EnvDefinition` from each env package's default `"."` export and use the package name as env identity.
- Support explicit single inheritance through `EnvDefinition.extends`, including local or external parents, while retaining the declaring env entry and dependency context of every effective service.
- Materialize local env components with one Bit-lite-owned, non-configurable TypeScript compiler so env packages terminate configurable compile traversal.
- Let each ordinary component obtain its compile vendor and opaque JSON config from its own effective env; do not assume one compiler implementation or one TypeScript configuration across a dependency graph.
- Preserve the configured package reference and resolved installed version as structured selected-env identity across runtime groups, JSON-only worker data, command-owned results, preview state, and vendor-owned file discovery.
- Reuse one canonical workspace parser and component registry across link, install, env loading, test, preview, and compile.
- Migrate the demo to external Node and Vue env packages plus a local React env Bit component that exercises `extends`, generated in-package configuration, and external package-subpath configuration.

**Non-Goals:**

- JavaScript env factories or dynamic env-definition generation. The first-phase package entry is JSON only.
- Lint or typecheck command workflows.
- Env aliases, `defaultEnv`, path or component-pattern assignment, workspace env/service overrides, or automatic framework detection.
- Env-level `files`/`patterns`, a generic command-side target resolver, or configurable target discovery. Each service/vendor owns file discovery; maintained test vendors retain their hard-coded test/spec patterns.
- A cloud env registry, env publishing/versioning commands, automatic dependency-conflict resolution, or peer dependency auto-installation.
- Multiple inheritance, alias-based parents, deep service merging, or workspace-supplied inheritance/overrides. A single full-package-name `EnvDefinition.extends` is in scope.
- A configurable compiler for env components. Only ordinary components use package-defined `services.compile`.
- Redesigning preview browser routing/rendering or test/preview result content beyond replacing the legacy string env identity with a structured package identity.

## Decisions

### 1. Use one canonical component registry and version-driven env classification

`bit-lite-context` will own a public static workspace parser:

```ts
type PackageRef = {
  packageName: string;
  version: string;
};

type WorkspaceComponentConfig = {
  path: string;
  id: string;
  packageName: string;
  env: PackageRef;
};

type WorkspaceConfig = {
  defaultScope?: string;
  components: WorkspaceComponentConfig[];
};
```

Link, install, runtime loading, and service commands consume this parser instead of independently reading `bit-lite.json`. Package-level `.comp.json` remains the source of component package metadata and adds an optional explicit component kind:

```ts
type ComponentKind = "component" | "env";

type ComponentPackageConfig = {
  kind?: ComponentKind; // defaults to "component"
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
};
```

The explicit `kind: "env"` marker lets link and compile choose the env package strategy before loading its definition. Inferring the kind only from incoming env references was rejected because an unreferenced local env would otherwise change package shape depending on who currently consumes it.

Every component record, including an env component, retains an explicit `env` reference. That reference remains the assignment source of truth and creates a logical development dependency; authors do not duplicate it in `.comp.json.devDependencies`. If the same package is also a normal runtime dependency, for example because a local child env both uses and `extends` the same parent, the runtime dependency wins in the generated manifest while both semantic edges remain in registry metadata.

Classification is determined by the configured version before package resolution:

- `workspace:` requires `env.packageName` to exist in the current Bit component registry and requires the target to have `kind: "env"`.
- A normal semver or supported package-manager spec always denotes an external package. A same-named Bit component or root pnpm workspace package does not shadow it.
- Root pnpm-workspace membership by itself never makes an env local.
- Components using one env package name in this first phase use one version specifier. Runtime grouping keys derive from the selected package reference, while public/runtime contracts retain structured identity rather than exposing a bare package-name key as `envName`.

The parser rejects legacy top-level `envs`, `envName`, object-form component mappings, aliases, defaults, and overrides with targeted migration errors. It validates duplicate path, component ID, and component package name before installation or env loading.

Alternative considered: determine locality from the root pnpm workspace. Rejected because `demo-config` and `demo-vendors` are repository workspace packages but are not components in `demo-workspace`, and because normal-version references must remain capable of selecting a published package with the same name as a local component.

### 2. Model the selected env as a development dependency

`component.env` is a build/test/preview tool relationship, not a runtime import of the component's published package. Dependency-project generation therefore synthesizes it as a logical dev dependency:

- An external env is installed in the component's development dependency context using the configured normal version.
- A local `workspace:` env is linked to the registered env component package and recorded as an internal tooling edge.
- Physical package-manager deduplication is an installation detail and does not change the per-component dev dependency semantics.

Env loading begins from the selected component's dependency context. Loaded runtimes are cached by canonical entry and requested version so repeated references reuse parsing and inheritance work. The implementation may also expose a generated dependency-root fallback for diagnostics and shared installations, but it must not use workspace-first lookup to replace an explicitly external reference with a local package.

An inheritance parent has different semantics. `EnvDefinition.extends` makes the parent necessary whenever a consumer loads the child env, so the parent must appear in the child env package's normal `dependencies`, not only in `devDependencies`. The loader reads the declared version from that dependency entry and resolves the parent from the child env's dependency context.

Alternative considered: make `devDependencies` alone identify env assignment. Rejected because a component may have many development packages and only the explicit `env` field identifies its environment.

### 3. Make the default env package entry a JSON definition

Every env package's default `"."` export resolves to a JSON file containing one `EnvDefinition`. The loader resolves the public entry through the selected package context, canonicalizes symlinks, locates the owning manifest without requiring `package.json` to be exported, verifies package name/version, reads the entry with `readFile`, parses it with `JSON.parse`, and validates it. It does not use ESM JSON import attributes and does not execute package code to construct the definition.

```ts
type LoadedEnvServiceRuntime = {
  definition: EnvServiceConfig;
  declaredBy: string;
  packageRoot: string;
  entryUrl: string;
  entryDirectory: string;
};

type LoadedEnvRuntime = {
  packageName: string;
  requestedVersion: string;
  installedVersion: string;
  packageRoot: string;
  entryUrl: string;
  entryDirectory: string;
  effectiveDefinition: EnvDefinition;
  services: Partial<Record<SupportedEnvServiceName, LoadedEnvServiceRuntime>>;
  inheritanceChain: string[];
};

type SelectedEnvIdentity = {
  packageName: string;
  requestedVersion: string;
  installedVersion: string;
};
```

The definition `name` must exactly match the resolved package manifest name. JSON parsing and protocol validation happen before vendor or config module loading. All runtime data retained from the definition is recursively JSON-safe. `requestedVersion` preserves the configured package-manager spec such as `workspace:*` or `^1.2.0`; `installedVersion` records the resolved manifest version. A selected-env identity is projected from the loaded runtime when a smaller JSON-safe value must cross a service or worker boundary.

Alternative considered: support JSON and a JavaScript factory simultaneously. Deferred because a single static entry keeps identity, caching, validation, and security behavior deterministic; dynamic factories can be proposed later if a concrete use case requires them.

### 4. Materialize local env components with a fixed built-in compiler

A local `kind: "env"` component uses a dedicated Bit-lite-owned TypeScript compiler that cannot be selected, replaced, or configured by any env definition. This is the only deliberate compile hardcode. Its responsibility is package materialization, not ordinary component compilation:

1. Require a JSON main entry such as `index.json`.
2. Copy the JSON entry and other supported static files while preserving relative paths.
3. Transpile env-owned `.ts` support/config files with fixed compiler settings to matching `.js` paths.
4. Generate an env component package manifest whose default `"."` export points to the generated JSON entry, for example `./dist/index.json`.
5. Leave generated support modules private unless explicit component export support is added later; env JSON may reference them relatively.

For example:

```text
components/envs/react/
  index.json
  webpack-react.ts
  .comp.json

node_modules/@my-scope/env.react/
  package.json                exports "." -> ./dist/index.json
  src -> components/envs/react
  dist/index.json
  dist/webpack-react.js
```

The env component's own selected env remains meaningful for its other development services and as a logical dev dependency, but it is never consulted to compile the env component. Local env packages are materialized before definitions are loaded. Local env-to-env package dependencies are ordered using normal internal dependency metadata, and an env component is a terminal boundary for configurable compile traversal.

Alternative considered: compile a local env with its selected env's `services.compile`. Rejected because loading that service requires the local env graph to be materialized first and permits self-hosting or cycles to make clean installation nondeterministic.

Alternative considered: link JSON directly from source without a compile step. Rejected because the demo intentionally includes an env-owned TypeScript vendor configuration and published/local package shape should consistently reference generated, executable files.

### 5. Resolve inheritance recursively and retain service origin

`EnvDefinition.extends` is an optional full npm package name, never an alias or path. The loader requires the parent in the child package's normal dependencies, resolves and validates the parent first, and repeats recursively. A recursion stack of canonical entries reports complete inheritance cycles.

Effective definitions use shallow rules:

- An omitted child service is inherited together with the parent's declaring package and entry origin.
- A child service replaces the complete parent service and receives the child's origin.
- Top-level `config` is shallow-merged with child keys winning.
- Final identity and grouping always use the selected child's package reference and resolved version rather than the inheritance parent's identity.

The uses-env edge, package dependency edge, and `extends` edge remain distinct even when they name the same package. The first selects development behavior, the second makes packages resolvable, and the third defines semantic inheritance.

### 6. Resolve module-bearing fields from the declaring env entry

The JSON definition does not wrap every config value with origin data. The loader instead records origin beside each effective service, and command-side adapters resolve only fields with defined module semantics.

| Input source | Resolution base |
| --- | --- |
| Relative module/config specifier declared by an env service | Directory containing the declaring env's resolved JSON entry |
| Bare package or exported package subpath declared by an env service | Declaring env package's dependency context via Node exports |
| Vendor package | Declaring env package's dependency context, then documented workspace fallback |
| CLI workspace file argument | Workspace root |

For a React env whose entry is `dist/index.json`, `configFile: "./webpack-react.js"` resolves to `dist/webpack-react.js`. A relative specifier must remain inside the declaring env package root. Inherited services use the ancestor entry directory, while commands continue grouping and reporting them under the selected child's structured env identity.

Known module-bearing fields such as preview `configFile`, `mounter`, and `docsTemplate` are resolved before worker startup and converted to canonical paths or URLs. Arbitrary vendor JSON strings are not guessed to be paths. A vendor that introduces another module-bearing field requires a typed service adapter rather than generic recursive rewriting.

Alternative considered: resolve relative fields from the package root. Rejected because generated env entries and their TypeScript support files live together under `dist`; entry-directory-relative specifiers preserve their relationship without exposing private support modules as package subpaths.

### 7. Keep a strict JSON-safe three-service definition

`bit-lite-env` removes workspace-oriented env types and exposes a static package-owned protocol:

```ts
type SupportedEnvServiceName = "test" | "preview" | "compile";

type EnvServiceConfig<Config extends JsonObject = JsonObject> = {
  vendor: string;
  config?: Config;
};

type EnvDefinition = {
  name: string;
  extends?: string;
  services: Partial<Record<SupportedEnvServiceName, EnvServiceConfig>>;
  config?: JsonObject;
};
```

Service objects accept only `vendor` and optional recursively JSON-safe `config`. The shared contract rejects unknown services, empty vendors, `mode`, selected components, workspace/component roots, callbacks, loaded modules, and generic `targets`, `files`, or `patterns`. Vendor-specific compiler settings, including an inline TypeScript configuration or a vendor-defined config module specifier, belong inside opaque service `config`; the shared compile contract does not assume TypeScript.

Test and preview retain command-owned selection, mode, lifecycle, result validation, and shutdown. Their result identity changes from a bare `envName` string to the structured selected-env identity, while their remaining result content stays command-owned. Their vendors continue discovering files from selected component descriptors, including maintained hard-coded test patterns.

### 8. Make ordinary-component compile env-specific and dependency-aware

The configurable compile pipeline applies only to ordinary components. It links output package shells, computes topological layers from ordinary component runtime dependencies, and for every ready component obtains the effective `services.compile` from that component's selected env. A dependency and its consumer may use different envs, compiler vendors, or configs; the dependency is completed with its own compile service before its consumer starts with another.

Batching ready work by env or identical service runtime is an optimization only. The command must preserve per-component env selection and must not load one global compiler or assume one tsconfig. A missing or failed compile service prevents dependent later layers while allowing independent ready work to report its own result. `install --compile` calls the same pipeline after dependency installation, linking, fixed env-component materialization, and env JSON loading.

The fixed env-component compiler and the env-selected ordinary-component compiler are separate mechanisms:

```text
kind: env        -> fixed Bit-lite env compiler -> terminal
kind: component  -> selected env.services.compile -> dependency layers
```

### 9. Resolve vendors in the parent and narrow the worker boundary

`VendorTaskStartOptions` carries the selected loaded env identity, the effective service's declaring package/entry origin, selected components, args, service config, and command runtime. Parent-side preparation resolves and imports the vendor from the declaring env package context before the documented workspace fallback and validates `meta: VendorDefinition` plus the required entry.

Worker-facing `VendorData` contains only `env: SelectedEnvIdentity`, component descriptors, config, parsed args, and explicit command runtime values. Loaded env runtimes, modules, callbacks, maps, and resolver functions remain in the parent. Commands continue owning run/event result validation and presentation.

### 10. Use structured selected-env identity across runtime and service boundaries

Persisted component assignment continues using `env: PackageRef`, where `version` is the requested package-manager spec. Loaded runtime code uses `LoadedEnvRuntime`, which contains both requested and installed versions. Boundaries that must remain JSON-safe use the smaller `SelectedEnvIdentity`; they do not invent another `envName`, `envPackageName`, or combined public string field.

Workspace groups reuse their `env: LoadedEnvRuntime` and contain selected component descriptors without copying `env.packageName`. Parent-side vendor tasks retain the loaded env identity needed for resolution, then project it to `VendorData.env` for inline or worker execution. Vendor task results, test result context, preview service results, compile vendor input, result-store entries, prepared preview state, skipped-preview state, and preview proxy manifests carry the same structured `env` object. Maintained demo vendors mirror those contracts.

Internal maps, task IDs, temporary directory names, and routing helpers may derive a deterministic key from `packageName` plus `requestedVersion`, but that key is an implementation detail and is not returned as env identity. Preview public URLs continue using the selected package name in this phase because workspace validation allows only one version specifier for a package name; the preview manifest beside those URLs carries full identity. If isolated simultaneous versions are added later, their route-disambiguation scheme requires a separate design.

`EnvDefinition.name` remains a package name checked against the resolved manifest. `EnvDefinition.extends` remains a parent package name whose version is read from the child package's normal dependencies. Adding versions to either JSON field would duplicate package metadata and create competing sources of truth.

Alternative considered: rename `envName` to `envPackageName` and continue passing a string. Rejected because it preserves the version-loss problem and makes grouping/result correctness depend implicitly on the current same-name/same-version restriction.

### 11. Use one local extending env and two external envs in the demo

The maintained demo uses three env identities without pretending all three are local:

- Node is an external env package selected with a normal version by `lib/math`.
- Vue is an external env package selected with a normal version by `vue/card`.
- React is `@my-scope/env.react`, a real `kind: "env"` Bit component under `packages/demo-workspace/components/envs/react`, selected with `workspace:*` by React UI components.

The React env component itself selects the external Node env as its explicit env/dev dependency. Its `.comp.json` declares the Node env as a normal dependency because its `index.json` also uses `extends` to inherit Node services. The JSON replaces at least one service and omits at least one inherited service so both inheritance paths are visible.

The React env moves the existing TypeScript Webpack configuration out of `demo-config` into `webpack-react.ts`. The fixed env compiler emits `dist/webpack-react.js`, and the React JSON preview service references `./webpack-react.js`. Runtime packages used by that file, including loaders, framework packages, and shared utilities, become dependencies or peers of the React env component rather than accidental workspace dependencies.

The same preview service continues referencing mounter and docs-template subpaths from `demo-config`, exercising both declaring-entry-relative resolution and package-export resolution. `demo-vendors` remains the service implementation package and retains vendor-owned discovery behavior. No env declares files or patterns.

Alternative considered: create Node, React, and Vue as root pnpm workspace env packages. Rejected because it would demonstrate monorepo linking but not a local Bit env component, and would fail to distinguish pnpm workspace membership from Bit workspace membership.

## Risks / Trade-offs

- [Breaking config migration stops existing workspaces] → Ship targeted legacy-field errors and update maintained configs and READMEs atomically.
- [A JSON package entry is not imported like a JavaScript default export] → Resolve the package export to a file URL, read and parse it explicitly, and test packages whose manifests hide `package.json`.
- [The explicit env component kind adds a component-package special case] → Keep it narrow: only entry validation, fixed materialization, and compile-boundary behavior differ; identity, dependencies, linking, and package loading remain shared.
- [An env ref and `extends` can make one parent both a dev and runtime dependency] → Preserve both semantic edges, emit one runtime dependency in the manifest, and diagnose version disagreement.
- [External envs may also be root pnpm workspace packages in repository fixtures] → Classify by configured spec and Bit registry only, and test that pnpm membership never changes an external reference into a local one.
- [Generated relative support modules can escape or become stale] → Preserve source-relative output paths, resolve from the canonical entry directory, reject package-root escape, and materialize env packages before every env-aware compile flow.
- [The built-in env compiler may become an attractive customization point] → Treat non-configurability as a protocol invariant; env authors customize only the compile service they provide to ordinary components.
- [Different compiler vendors/configs complicate cross-env builds] → Keep one global component dependency order, select service per component, isolate result validation, and stop only dependent later work after failure.
- [Tool dependency graphs may load duplicate framework/compiler versions] → Resolve from declaring env contexts first, surface missing/incompatible peer causes, and defer automated conflict solving.
- [Strict same-name/same-version grouping limits mixed-version experiments] → Retain it for this phase and defer isolated simultaneous env versions.
- [Structured env identity breaks vendor and result consumers that read `envName`] → Migrate parent tasks, worker data, command validators, preview manifests, result storage, maintained vendors, fixtures, and docs atomically, with contract tests rejecting legacy result shapes.
- [Requested and installed versions can be confused] → Use distinct field names at loaded/runtime boundaries; reserve `PackageRef.version` for the configured spec and never serialize a combined `name@version` string as canonical identity.

## Migration Plan

1. Introduce the canonical static workspace parser, `kind: "env"` component metadata, registry-based local env validation, and derived env dev-dependency metadata.
2. Update install/link to place external envs in component development contexts, link internal env tooling edges, generate env package manifests, and materialize local env components with the fixed compiler.
3. Replace factory-oriented protocol/loading with exported JSON entry resolution, parsing, validation, recursive package-based inheritance, caching, and per-service entry-origin metadata.
4. Add entry-relative and dependency-context module/vendor resolution and narrow the worker boundary without changing vendor-owned file discovery.
5. Migrate test and preview, including inherited and in-package preview module resolution.
6. Replace global ordinary-component compile selection with the per-component effective compile pipeline and route `install --compile` through env materialization, loading, and dependency layers.
7. Add external Node/Vue demo env packages, the local React env component and its generated Webpack config, migrate `bit-lite.json`, and update documentation.
8. Replace runtime-group, vendor/worker, command result, compile input, result-store, preview state/manifest, and maintained demo-vendor `envName` fields with structured selected-env identity while retaining package-name-only preview URLs.
9. Remove inline envs, alias inheritance, remaining non-migration `envName` usage, patterns, duplicate readers, factory code, and the global hard-coded ordinary-component compiler path; then run focused and repository-wide verification.

The cutover is atomic at repository level. Rollback is a source revert restoring the previous config and demo together. No persisted data migration is required beyond editing workspace/component JSON.

## Open Questions

No question blocks this phase. Follow-up proposals may consider JavaScript env factories, additional env entry formats, isolated simultaneous versions, configurable target discovery, third-party service registration, deeper inheritance controls, or lint/typecheck commands.

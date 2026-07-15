## Why

Workspace-local env aliases and inline service configuration make `bit-lite.json` grow with every framework and tool variation, while preventing an env from behaving like the component package it will eventually be published from. Env definitions should instead be explicit package dependencies: a local env is a Bit component in the current workspace, while the same env outside that workspace is consumed as an ordinary npm package.

## What Changes

- **BREAKING** Replace top-level `envs`, component `envName`, pattern-based component mappings, alias-based workspace env inheritance, and inline workspace service overrides with an explicit `{ packageName, version }` env package reference on every component record.
- Interpret `workspace:` env references through the current Bit component registry, not through root pnpm-workspace membership. A matching local env must be a registered Bit component; a normal version spec always denotes an external package dependency even when a same-named package exists elsewhere in the monorepo.
- Treat each component's selected env as a development dependency derived from its `env` reference. Keep the explicit `env` field as the assignment source of truth, while keeping an `EnvDefinition.extends` parent as a normal runtime dependency of the child env package.
- Require each env package's default `"."` package export to resolve to a JSON `EnvDefinition`. Resolve the exported entry, parse and validate its JSON, and retain the configured `{ packageName, version }` reference together with the resolved package name and installed version without executing an env factory.
- Allow an env definition to `extends` one parent env package by full npm package name, resolve that parent recursively from the child package's declared dependencies, and preserve the declaring package origin of every inherited service.
- Materialize local env components with a Bit-lite-owned, non-configurable TypeScript compiler rather than with their selected env's `compile` service. The built-in compiler copies the JSON entry and transpiles env-owned TypeScript support files, making an env component a terminal boundary in configurable compile traversal.
- Resolve env-owned relative module/config specifiers from the directory containing the declaring env entry, resolve package and exported-subpath specifiers from the declaring env package's dependency context, and report contextual errors for unresolved entries, parents, vendors, peers, or configuration modules.
- Standardize package-owned env definitions for `test`, `preview`, and `compile` around the existing JSON-safe vendor/config contract without embedding component selection, execution mode, or generic file targets.
- Migrate test and preview service lookup from workspace-local env configuration to loaded env packages. Migrate ordinary-component compile from a globally hard-coded vendor to each component's effective env service, allowing different compiler vendors and configs, including different TypeScript configurations, while retaining dependency ordering and command-owned orchestration.
- Replace runtime and service-boundary `envName` strings with structured JSON-safe env identity. Workspace groups SHALL reuse their loaded env runtime instead of duplicating its package name, while vendor/worker input, test and preview results, compile vendor input, result storage, and preview manifests SHALL carry the selected package name, requested version, and installed version. Internal grouping/task keys SHALL derive from the selected package reference rather than becoming another public identity field.
- Replace the demo's single multi-env `demo-config` assignment with external Node and Vue env packages plus a React env that is a real Bit component under `packages/demo-workspace`. The local React env uses a JSON entry, extends the external Node env, inherits and replaces services, and owns a TypeScript Webpack config whose generated JavaScript is referenced relatively from the same env package. Other preview modules remain exported subpaths of `demo-config` so both resolution forms are exercised.
- Keep component assignment as `env: { packageName, version }`. Keep `EnvDefinition.name` and `EnvDefinition.extends` as package-name-only fields because the env's own version belongs to its package manifest and an inheritance parent's version belongs to the child package's dependencies. Do not add lint or typecheck commands, env aliases, `defaultEnv`, component-pattern assignment, workspace env overrides, env-declared `files`/`patterns`, a generic target resolver, a cloud env registry, or advanced dependency-conflict resolution. File discovery remains owned by each service/vendor; the maintained test vendors keep their current hard-coded test patterns.

## Capabilities

### New Capabilities
- `component-env-assignment`: Defines explicit per-component env package references, Bit-registry-based local identity, derived env development dependencies, validation, uniqueness, and removal of implicit assignment mechanisms.
- `env-package-loading`: Defines JSON package-entry resolution, local env-component materialization, external package loading, package-based inheritance, env identity, caching, origin-aware module/vendor resolution, and actionable loading failures.
- `env-service-execution`: Defines how package-owned test, preview, and compile definitions feed existing command workflows, how ordinary components select compile behavior per env, and how the built-in env-component compiler terminates recursive compile preparation.

### Modified Capabilities
- `preview-input-preparation`: Resolves preview `configFile`, `mounter`, and `docsTemplate` from the effective service's declaring env entry or package dependency context instead of treating the workspace as their origin.

## Impact

- Affects the public `bit-lite.json` schema and removes compatibility with inline `envs`, `envName`, alias-based workspace inheritance, and pattern mapping forms; package-based `EnvDefinition.extends` replaces the old inheritance location.
- Changes component registry and install semantics so local envs are registered Bit components, external envs are logical component dev dependencies, and inheritance parents remain runtime dependencies of env packages.
- Changes runtime loading in `bit-lite-context` from factory import/invocation to JSON entry parsing, and changes `bit-lite-env` types and validation to a strict static definition protocol.
- Changes component linking/compilation so local env components use a fixed built-in compiler and generated JSON entry, while ordinary components obtain compile vendors and opaque JSON configs from their own effective envs.
- Updates `bit-lite-context` runtime grouping, `bit-lite-vendors`, the `test`, `preview`, and `compile` commands, result storage, preview preparation/proxy manifests, and maintained demo vendors to preserve a structured selected-env identity separately from declaring-env origin across inline and worker execution.
- Migrates `packages/demo-workspace` to include a local React env component alongside externally resolved Node and Vue env packages, and moves one TypeScript Webpack configuration from `demo-config` into the React env package.
- Requires focused registry, install, JSON-loader, inheritance, source/config output, origin-resolution, multi-compiler, command, and end-to-end coverage without changing vendor-owned file discovery.

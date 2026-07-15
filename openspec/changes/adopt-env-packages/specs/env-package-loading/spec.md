## ADDED Requirements

### Requirement: Env packages resolve according to their configured identity
For every distinct env package reference, workspace loading SHALL resolve a `workspace:` reference through the current Bit component registry and a normal version through the selecting component's installed development dependency context. It SHALL locate the canonical package entry and package root, read the package manifest, and verify that the package name and installed version satisfy the configured identity without allowing a local package to shadow an external reference.

#### Scenario: Registry env is installed
- **WHEN** `@acme/env.node@^1.2.0` resolves from a component's development dependency context and its installed manifest version satisfies the range
- **THEN** the loader records its canonical entry, package root, package name, and installed version

#### Scenario: Local env component is linked
- **WHEN** `@acme/env.react@workspace:*` resolves to a registered and materialized env component
- **THEN** the loader uses that generated component package as the authoritative entry rather than a root pnpm workspace package

#### Scenario: External reference has the same name as a local component
- **WHEN** a normal-version env reference has the same package name as a registered env component
- **THEN** resolution remains in the external development dependency context and does not load the local generated package

#### Scenario: Env package is not installed
- **WHEN** an external env cannot be resolved from the selecting component's dependency context or documented generated fallback
- **THEN** workspace loading fails with the package name, requested version, component IDs, attempted contexts, and an instruction to install dependencies

#### Scenario: Installed version does not satisfy the reference
- **WHEN** the resolved package manifest version is incompatible with the component's requested range
- **THEN** workspace loading fails before reading the env definition and reports both versions

### Requirement: Local env components use fixed materialization
A registered `kind: "env"` component SHALL be materialized by a Bit-lite-owned, non-configurable TypeScript compiler before env loading. The compiler SHALL copy its JSON entry and supported static files, transpile env-owned TypeScript support files to matching JavaScript output paths, and generate a package manifest whose default `"."` export points to the generated JSON entry. It SHALL NOT consult that component's selected env or any `services.compile` definition.

#### Scenario: JSON-only env component is materialized
- **WHEN** a local env component contains `index.json` and no TypeScript support files
- **THEN** the built-in compiler emits `dist/index.json` and the generated package default export resolves to it

#### Scenario: Env owns a TypeScript vendor config
- **WHEN** a local env component contains `webpack-react.ts` beside `index.json`
- **THEN** the built-in compiler emits `dist/webpack-react.js` beside `dist/index.json` using fixed compiler behavior

#### Scenario: Env definition declares a compile service
- **WHEN** a local env JSON contains `services.compile`
- **THEN** that service remains available to ordinary consumers but is not used to materialize the env component itself

#### Scenario: Configurable compile traversal reaches an env component
- **WHEN** dependency or tooling preparation encounters a local env component
- **THEN** the fixed materialization result is used and configurable compile traversal does not recurse through that env's selected compile service

### Requirement: Env packages export JSON definitions
An env package's default `"."` export SHALL resolve to a JSON file containing its `EnvDefinition`. The loader SHALL read and parse that file without ESM JSON import attributes, validate it once per canonical entry and requested version, and reuse the loaded runtime for all matching component references.

#### Scenario: JSON definition is shared by multiple components
- **WHEN** three components reference the same validated env package and version
- **THEN** the loader reads, parses, validates, and resolves inheritance for the canonical JSON entry once and all three components reuse the loaded runtime

#### Scenario: Default export is not JSON
- **WHEN** the default package entry resolves to a JavaScript module or another unsupported entry type
- **THEN** workspace loading fails with the env package, resolved entry, and required JSON-entry contract

#### Scenario: Exported JSON is malformed
- **WHEN** the resolved env entry contains invalid JSON
- **THEN** loading fails in the parse phase with the env package, entry path, affected components, and original parse cause

#### Scenario: Default package export is missing
- **WHEN** package resolution cannot resolve the env package's default `"."` export
- **THEN** loading fails before definition validation with the requested package and attempted dependency context

### Requirement: Env definitions support package-based inheritance
An `EnvDefinition` MAY declare one `extends` field containing the full npm package name of its parent env. The loader SHALL require that parent in the child env package's normal dependencies, use the declared dependency version as the parent reference, resolve and validate the parent from the child package's dependency context, and repeat recursively before constructing the child's effective definition. Aliases, relative paths, multiple parents, dev-only parent declarations, and workspace-supplied parent mappings SHALL NOT be accepted.

#### Scenario: Child inherits an omitted service
- **WHEN** a child env extends a declared parent package, the parent defines test and compile, and the child defines only preview
- **THEN** the effective child env contains the parent's test and compile services plus the child's preview service

#### Scenario: Child replaces a parent service
- **WHEN** a child and its parent both define test
- **THEN** the child's complete test service replaces the parent's vendor and config rather than deep-merging them

#### Scenario: Parent and child define top-level config
- **WHEN** parent and child top-level config objects contain distinct keys and one shared key
- **THEN** the effective config contains both distinct keys and the child's value for the shared key

#### Scenario: Inheritance chain is recursive
- **WHEN** an env extends a parent that extends a grandparent and all dependencies resolve
- **THEN** the loader resolves the grandparent first, applies each shallow merge in order, and retains the selected child's package name as final identity

#### Scenario: Parent is not a runtime dependency
- **WHEN** `extends` names a package absent from the child env package's normal dependencies or present only in its development dependencies
- **THEN** env loading fails with the child package, parent package, and required runtime dependency declaration

#### Scenario: Inheritance chain is circular
- **WHEN** resolving `extends` reaches a canonical env package entry already present in the active inheritance chain
- **THEN** env loading fails and reports the complete package chain without reading further definitions

### Requirement: Loaded env definitions have package identity
The parsed JSON SHALL be a valid `EnvDefinition` whose `name` exactly equals the resolved npm package name, whose optional top-level `config` is JSON-safe, and whose `services` satisfy the env service contract. The loader SHALL reject identity mismatches rather than normalizing or aliasing them.

#### Scenario: JSON definition has the matching name
- **WHEN** `@acme/env.react` exports an otherwise valid definition named `@acme/env.react`
- **THEN** the definition is accepted with that package name as its env identity

#### Scenario: JSON definition contains an alias
- **WHEN** `@acme/env.react` exports a definition named `react`
- **THEN** workspace loading fails and reports the expected and actual names

#### Scenario: Definition contains forbidden service fields
- **WHEN** the JSON definition contains execution state or generic target configuration outside the env service contract
- **THEN** validation fails before a vendor task is created

### Requirement: Env-owned specifiers retain their declaring-entry origin
The loaded env runtime SHALL retain the declaring package name, package root, entry URL, and entry directory for every effective service separately from its JSON-safe definition. Relative module paths declared by a service SHALL resolve from the directory containing that declaring env's JSON entry and SHALL remain inside its package root. Package and package-subpath specifiers SHALL use Node package exports from the declaring package's dependency context; vendor package resolution SHALL try the declaring package context first and the documented workspace context second. An inherited service SHALL retain its ancestor's origin even though commands group and report it under the selected child env identity.

#### Scenario: Env declares a generated relative config module
- **WHEN** a React env entry at `dist/index.json` declares `configFile: "./webpack-react.js"`
- **THEN** the service adapter resolves `dist/webpack-react.js` from the React env entry directory rather than the process current directory or workspace root

#### Scenario: Child inherits a relative config module
- **WHEN** a child env inherits a parent preview service whose config uses a relative module specifier
- **THEN** preview preparation resolves it from the parent env entry directory while retaining the child env identity for grouping and output

#### Scenario: Env declares an exported package subpath
- **WHEN** an env service names `demo-config/previewers/react-mounter`
- **THEN** resolution honors that package's exports map from the declaring env package dependency context

#### Scenario: Relative config escapes its package
- **WHEN** a relative module specifier resolves outside the declaring env package root
- **THEN** preparation fails with the env, service field, original specifier, and rejected path

#### Scenario: Vendor exists only in the workspace
- **WHEN** an env's vendor cannot be resolved from the env package but is resolvable from the documented workspace context
- **THEN** vendor loading uses the workspace package as the explicit fallback

### Requirement: Env loading failures preserve actionable context
Errors produced while resolving, materializing, reading, parsing, inheriting, or validating an env package SHALL identify the env package, requested version, affected component IDs, failing phase, and attempted origin while preserving the original cause. The workspace SHALL NOT continue with a partial or silently substituted env definition.

#### Scenario: Env-owned config dependency is missing
- **WHEN** resolving an env-owned generated configuration fails because one of the env package's required dependencies is absent
- **THEN** preparation fails with the selected env, declaring env, configuration module, and original missing-module cause

#### Scenario: One of several env packages is invalid
- **WHEN** one referenced env definition fails validation after other envs loaded successfully
- **THEN** the command aborts workspace loading and does not regroup those components under another env

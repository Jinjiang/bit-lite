## ADDED Requirements

### Requirement: Every component declares an explicit env package
`bit-lite.json` SHALL represent components as an array of records. Every record, including a record for an env component, SHALL contain non-empty `path`, `id`, and valid npm `packageName` fields plus an `env` object containing `packageName` and `version`; the env package name SHALL be the component's environment identity.

#### Scenario: Components select different env packages
- **WHEN** one component declares `@acme/bit-env-react` and another declares `@acme/bit-env-node`
- **THEN** workspace loading retains both explicit references without deriving either assignment from component paths or IDs

#### Scenario: Env component declares its own env
- **WHEN** a registered React env component declares an external Node env in its component record
- **THEN** the registry retains the Node env as the React env component's selected development environment independently of the React definition's optional `extends`

#### Scenario: Component omits its env reference
- **WHEN** a component record has no `env` object or omits either `env.packageName` or `env.version`
- **THEN** configuration validation fails with the component ID or record index and the missing field

### Requirement: Workspace protocol identifies a registered env component
The system SHALL validate `env.packageName` as an npm package name and `env.version` as a supported semver or package-manager version specifier. A `workspace:` env reference SHALL resolve by package name through the current Bit component registry and its target SHALL be marked `kind: "env"`. Root pnpm-workspace membership alone SHALL NOT make a package a local env.

#### Scenario: Local env component uses workspace protocol
- **WHEN** a component references `@acme/env.react@workspace:*` and that package name belongs to a registered `kind: "env"` component
- **THEN** validation records an internal tooling edge to that env component

#### Scenario: Workspace env is absent from the Bit registry
- **WHEN** a component references `demo-config@workspace:*` but `demo-config` is only a root pnpm workspace package and is not registered as a Bit component
- **THEN** validation fails with the component and missing local env package name

#### Scenario: Workspace target is not an env component
- **WHEN** a `workspace:` env reference resolves to a registered ordinary component
- **THEN** validation fails and identifies that the target is not marked `kind: "env"`

### Requirement: Normal versions identify external env dependencies
A normal semver or supported package-manager version on `component.env` SHALL denote an external package even when a same-named Bit component or root pnpm workspace package exists. Components using the same env package name in one workspace SHALL use the same version specifier in this phase.

#### Scenario: Normal version matches a local package name
- **WHEN** a component references `@acme/env.react@^1.0.0` and the Bit registry also contains a component named `@acme/env.react`
- **THEN** the reference remains external and SHALL NOT be replaced with the local component

#### Scenario: Root pnpm package is consumed externally
- **WHEN** a normal version references an env fixture that is a root pnpm workspace package but not a component in the current Bit workspace
- **THEN** Bit-lite treats it as an external dependency rather than requiring `workspace:`

#### Scenario: Components request conflicting versions
- **WHEN** two components use the same env package name with different version specifiers
- **THEN** workspace loading fails before resolving that env package and identifies both conflicting references

### Requirement: Selected envs are logical development dependencies
The system SHALL derive a logical development dependency from every explicit `component.env` reference without requiring authors to duplicate it in `.comp.json.devDependencies`. External envs SHALL be installed in the component development dependency context, while local envs SHALL produce internal tooling links and SHALL NOT become runtime dependencies of an ordinary component package.

#### Scenario: Component selects an external env
- **WHEN** an ordinary component selects `@acme/env.node@^1.0.0`
- **THEN** dependency-project generation includes the env in that component's development dependencies and excludes it from the generated runtime dependencies

#### Scenario: Component selects a local env
- **WHEN** an ordinary component selects `@acme/env.react@workspace:*`
- **THEN** linking creates an internal tooling relationship to the registered env component without publishing the env as a runtime dependency of the ordinary component

#### Scenario: Explicit dev dependency conflicts with the env reference
- **WHEN** `.comp.json.devDependencies` declares the selected env package with a version different from `component.env.version`
- **THEN** validation fails with both declarations instead of silently choosing one

#### Scenario: Env parent has two dependency roles
- **WHEN** a local child env selects a parent as its own env and also declares that package as a normal dependency for `EnvDefinition.extends`
- **THEN** the registry retains both semantic relationships while the generated package manifest emits the required runtime dependency once

### Requirement: Implicit env assignment forms are rejected
The workspace configuration SHALL reject top-level `envs`, component `envName`, object-form pattern mappings, env aliases, `defaultEnv`, and workspace env overrides. Env assignment SHALL NOT be inferred from component path, ID, framework, file extension, or declaration order.

#### Scenario: Legacy inline env configuration remains
- **WHEN** `bit-lite.json` contains top-level `envs` or a component record contains `envName`
- **THEN** validation fails with a migration message directing the user to a component-level env package reference

#### Scenario: Components use a pattern mapping
- **WHEN** `components` is an object that maps a glob pattern to an env name
- **THEN** validation fails instead of expanding the pattern into component assignments

### Requirement: Component registration remains unique and deterministic
Workspace loading SHALL reject duplicate component paths, component IDs, and component package names, SHALL preserve each record's env package reference, and SHALL produce a stable component ordering independent of filesystem discovery order.

#### Scenario: Duplicate package names use different envs
- **WHEN** two component records declare the same component `packageName` even if their env references differ
- **THEN** configuration validation fails with the duplicated package name

#### Scenario: Valid records are loaded from an unsorted file
- **WHEN** valid component records appear in an arbitrary order
- **THEN** the runtime component registry is ordered deterministically while each component retains its declared env reference

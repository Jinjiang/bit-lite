## Purpose

Define the canonical JSON-safe workspace snapshot, the parent-only resolved workspace context, canonical component reuse, derived workspace views, and the explicit preparation lifecycle between those phases.

## Requirements

### Requirement: Workspace is the canonical base snapshot
The system SHALL expose a `Workspace` that contains the absolute workspace root, config path, validated normalized `WorkspaceConfig`, and one deterministic array of canonical workspace components. Reading `Workspace` MAY inspect `bit-lite.json`, `.comp.json`, component directories, entry files, and local dependency declarations, but SHALL NOT require installed env packages, load env JSON, resolve env inheritance, or import vendor/config modules. Every public field of `Workspace` and its components SHALL be JSON-serializable.

#### Scenario: Workspace is read before dependencies are installed
- **WHEN** a valid workspace declares an external env package that is not installed yet
- **THEN** reading the base `Workspace` succeeds with the configured env package reference and component metadata without attempting to load the env

#### Scenario: Workspace is serialized
- **WHEN** the base `Workspace` is cloned through the vendor transport boundary
- **THEN** its root, normalized config, component identities, package metadata, dependency records, entry paths, and env references remain available without maps, functions, modules, or class-only state

### Requirement: Workspace components remain canonical through derived views
Each registered component SHALL have exactly one canonical `WorkspaceComponent` object in `Workspace.components`. Component selection, dependency ordering, env grouping, workspace context assembly, and vendor task preparation SHALL reuse those canonical component objects rather than constructing parallel `ComponentRef`, package-registry, runtime, or preview-specific copies with the same identity fields. Implementations MAY build private lookup indexes, but those indexes SHALL NOT become another canonical public workspace representation.

#### Scenario: Components are selected by a filter
- **WHEN** a command filters the base workspace to a subset of component IDs
- **THEN** the selected array contains the corresponding canonical workspace component objects in deterministic order

#### Scenario: Internal lookup index is built
- **WHEN** workspace preparation builds package-name and component-ID maps for validation or traversal
- **THEN** consumers still receive the same base `Workspace` and components and the maps do not appear in serialized workspace or vendor context data

### Requirement: WorkspaceContext resolves heavy execution facts by composition
The system SHALL expose a parent-only `WorkspaceContext` that contains the base `Workspace` plus resolved component contexts. Each component context SHALL reference its canonical workspace component and one resolved env context. The resolved env context SHALL retain one canonical selected-env identity, effective env config, effective services, inheritance identity, and package location. An inherited service SHALL reference the package location that declared it instead of flattening duplicate declaring-package and entry fields into unrelated workspace models.

#### Scenario: Component env is resolved
- **WHEN** `resolveWorkspace(workspace)` loads an installed env and its inheritance chain
- **THEN** the resulting component context references the original workspace component and an env context containing selected identity and effective services without copying the workspace config or component fields

#### Scenario: Child env inherits a service
- **WHEN** a selected child env inherits its test service from a parent package
- **THEN** the child component retains the child selected-env identity while the resolved test service references the parent package location as its source

### Requirement: Workspace indexes and groups are derived rather than stored facts
Env lookup maps, component lookup maps, dependency traversal state, unique env collections, component selections, and env groups SHALL be derived from `Workspace` or `WorkspaceContext` for the operation that needs them. `WorkspaceContext` SHALL NOT expose duplicated top-level `config`, `envs`, or permanently precomputed `groups` fields alongside the base workspace and resolved component contexts.

#### Scenario: Filtered components are grouped
- **WHEN** a command selects components and groups them by selected env
- **THEN** grouping derives groups from the selected component contexts and does not mutate or replace the canonical workspace or context

#### Scenario: Same package name uses one selected reference
- **WHEN** multiple selected components share the same env package reference
- **THEN** the derived group reuses their loaded env context and no package-name/version string key is exposed as a second public env identity

### Requirement: Workspace preparation follows explicit base and resolved phases
Install, link, dependency-project generation, and fixed local env materialization SHALL consume the base `Workspace`. Commands that need effective env services SHALL resolve a `WorkspaceContext` from the already-read base workspace after required installation, linking, and materialization steps. The system SHALL NOT re-read or reconstruct a competing workspace registry merely to enter the resolved phase.

#### Scenario: Test prepares a local env workspace
- **WHEN** test starts in a workspace containing a local env component
- **THEN** the command reads one base workspace, links and materializes from it, resolves the workspace context, and selects the test service without rebuilding base component metadata

#### Scenario: Install runs without compile
- **WHEN** install completes without requesting ordinary-component compilation
- **THEN** install may finish from the base workspace after dependency installation, linking, and env materialization without resolving every env service

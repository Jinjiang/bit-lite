## MODIFIED Requirements

### Requirement: Workspace preparation follows explicit base and resolved phases

Install, link, dependency-project generation, fixed local env materialization, and every component recording and history inspection operation SHALL consume the base `Workspace`. Commands that need effective env services SHALL resolve a `WorkspaceContext` from the already-read base workspace after required installation, linking, and materialization steps. The system SHALL NOT re-read or reconstruct a competing workspace registry merely to enter the resolved phase.

The two phases SHALL be separated by a package boundary rather than by convention. The base workspace model SHALL live in a package that does not depend on env resolution, so a base-phase operation cannot reach `WorkspaceContext`, env loading, or env grouping at all. Env resolution SHALL live in its own package depending on the base workspace model, and that dependency SHALL NOT be reversed.

That separation rests on a declared dependency meaning what it says, so declaration and import SHALL agree in both directions for every workspace package that has TypeScript sources. A workspace package named in another package's runtime dependencies SHALL be imported by that package's production sources; a workspace package reached from a package's sources SHALL be declared by it as a runtime or development dependency. A package that only tests against another SHALL declare it as a development dependency rather than a runtime one.

#### Scenario: Test prepares a local env workspace

- **WHEN** test starts in a workspace containing a local env component
- **THEN** the command reads one base workspace, links and materializes from it, resolves the workspace context, and selects the test service without rebuilding base component metadata

#### Scenario: Install runs without compile

- **WHEN** install completes without requesting ordinary-component compilation
- **THEN** install may finish from the base workspace after dependency installation, linking, and env materialization without resolving every env service

#### Scenario: Recording and inspection stay in the base phase

- **WHEN** a component recording or history inspection operation reads the workspace
- **THEN** it consumes the base `Workspace` and resolves no env
- **AND** it succeeds in a workspace whose dependencies have never been installed

#### Scenario: The base package cannot reach env resolution

- **WHEN** the packages providing the base workspace model and env resolution are inspected
- **THEN** the base workspace model declares no dependency on env resolution
- **AND** env resolution declares the base workspace model as a dependency

#### Scenario: A base-phase operation adds an env dependency by mistake

- **WHEN** code in the base workspace model attempts to import env loading, env grouping, or `WorkspaceContext`
- **THEN** the import cannot resolve, because the dependency is absent rather than merely discouraged

#### Scenario: A declaration outlives its import

- **WHEN** a package declares a workspace package that none of its production sources import
- **THEN** the declaration is reported, because it grants a reach nothing uses and would let a later import cross a boundary nobody decided to open

#### Scenario: An import outruns its declaration

- **WHEN** a package's sources import a workspace package it does not declare
- **THEN** the import is reported, because under the package manager it resolves only by an accident of hoisting

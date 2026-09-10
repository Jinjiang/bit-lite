## ADDED Requirements

### Requirement: A module is placed by what it does, and `utils` is not a placement

`bit-lite-utils` SHALL be the only place in the workspace named for utility, and it holds helpers that are generic by definition: they depend on no workspace package and know nothing of components, envs, vendors, or commands. A module that fails that test SHALL be placed by what it does, in a directory or package named for that, and SHALL NOT be collected into a directory named `utils` inside any other package.

Where a package arranges its modules in layers, that arrangement SHALL be asserted rather than documented alone: every import inside the package SHALL point towards a layer nearer the bottom of the stated order, and no directory SHALL exist that the order does not name. A layer stated to be independent of a part of the system SHALL be shown to reach no package belonging to it.

#### Scenario: A module has no obvious home

- **WHEN** a module is not generic enough for `bit-lite-utils` and no existing directory describes it
- **THEN** the layer or capability it belongs to is named and the module is placed there
- **AND** it is not placed in a `utils` directory pending a decision

#### Scenario: A layer imports upwards

- **WHEN** a module in one layer imports from a layer above it, or from a file above every layer
- **THEN** the arrangement is reported, so a cycle cannot form through the collection the layers replaced

#### Scenario: A layer reaches past its stated boundary

- **WHEN** a layer stated to know only about the command line imports a workspace, env, vendor, or history package
- **THEN** the import is reported rather than silently widening what that layer knows

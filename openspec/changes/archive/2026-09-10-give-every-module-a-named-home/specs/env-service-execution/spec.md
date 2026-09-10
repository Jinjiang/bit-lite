## ADDED Requirements

### Requirement: Each env service's result contract has one package

Every supported env service SHALL have exactly one workspace package declaring the result shape a vendor of that service produces, together with the guards that admit a result at the process boundary. A vendor implementation and the command that runs it SHALL both obtain that shape from that package; neither SHALL declare an equivalent shape of its own. Such a package SHALL depend on `bit-lite-vendors` and `bit-lite-utils` only, so that a vendor can be authored against the contract without reaching the workspace model, env resolution, or the CLI.

A contract package MAY also expose an alias for the vendor runtime of its service. It SHALL NOT contain execution, discovery, or presentation logic.

#### Scenario: A vendor is authored outside this repository

- **WHEN** an author writes a test, preview, or compile vendor
- **THEN** the service's result shape is importable from one package
- **AND** installing that package does not install the workspace model, env resolution, or the CLI

#### Scenario: A result shape gains a field

- **WHEN** a service's result shape changes
- **THEN** exactly one declaration changes, and producer and consumer cannot disagree about the shape because they read the same one

#### Scenario: A command validates what a vendor returned

- **WHEN** a command validates a produced run or event result
- **THEN** it uses the guard from that service's contract package rather than a locally written equivalent

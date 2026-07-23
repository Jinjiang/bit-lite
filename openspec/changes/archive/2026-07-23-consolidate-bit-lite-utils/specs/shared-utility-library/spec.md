## ADDED Requirements

### Requirement: Shared utility package boundaries
The workspace SHALL provide a private `bit-lite-utils` package with a browser-safe root entry and a separate Node-specific entry, and the package MUST NOT depend at runtime on another workspace package.

#### Scenario: Browser-safe utility import
- **WHEN** browser-targeted code imports a utility from `bit-lite-utils`
- **THEN** resolving the root entry does not import a Node built-in module

#### Scenario: Node utility import
- **WHEN** production code requires process, filesystem, path, networking, or HTTP helpers
- **THEN** it imports those helpers from `bit-lite-utils/node`

### Requirement: Selected generic utilities have canonical implementations
`bit-lite-utils` SHALL provide canonical implementations for `isRecord`, `isInteractiveTerminal`, `isNodeErrorCode`, `isJsonObject`, `sanitizeFileName`, `createComponentFileMap`, `formatExitCode`, `isFile`, `isFileUrl`, `listen`, `normalizeFilePath`, `readStringRecord`, `replaceExtension`, `sortStringRecord`, `toPosixPath`, `throwCombinedErrors`, `formatError`, `isJsonValue`, `collectFiles`, `readHost`, `readPort`, `escapeHtml`, `isPortUnavailableError`, `readDefaultExport`, `readJsonFile`, `readPackageName`, and `sendHtml`.

#### Scenario: Equivalent helper is consumed
- **WHEN** a production package needs one of the selected helpers whose existing implementations are equivalent
- **THEN** the package imports the canonical implementation instead of declaring another local implementation

#### Scenario: Consumer-owned types are involved
- **WHEN** a selected utility operates on vendor, compiler, preview, context, or demo-vendor data
- **THEN** the utility uses structural generics or callbacks without making `bit-lite-utils` depend on the consumer package

### Requirement: Existing behavior variants remain explicit and available
The shared utilities SHALL preserve the observable behavior required by every selected production consumer, and behavior variants MUST be selected explicitly rather than inferred from the importing package.

#### Scenario: Error formatting policy
- **WHEN** a consumer formats an unknown error
- **THEN** it can explicitly request message-only, stack-preferred, or object-message-aware formatting matching its previous behavior

#### Scenario: Combined error policy
- **WHEN** a consumer throws zero, one, or multiple collected errors
- **THEN** it can explicitly preserve whether repeated references are retained or deduplicated before single-error passthrough or `AggregateError` construction

#### Scenario: JSON number policy
- **WHEN** a consumer validates a JSON value or object
- **THEN** it can explicitly preserve whether non-finite numbers are rejected or accepted, including recursive arrays and objects

#### Scenario: Filesystem traversal policy
- **WHEN** a consumer recursively collects files
- **THEN** it can preserve its existing ignored directories, missing-directory handling, symlink behavior, result ordering, and traversal behavior

#### Scenario: Consumer-specific errors
- **WHEN** host, port, package-name, default-export, or JSON-file validation fails
- **THEN** the caller receives the same error class and message semantics that it received before consolidation

#### Scenario: Port availability policy
- **WHEN** a consumer checks whether a port is unavailable
- **THEN** it can preserve either code-only matching or recursive code, message, and cause matching

### Requirement: Host readers are unified without removing preview compatibility
All production `readHost` and `readPreviewHost` behavior SHALL be backed by one canonical host-reading implementation, while the existing `readPreviewHost` export MUST retain its signature and behavior.

#### Scenario: Host value is omitted
- **WHEN** a host reader receives `undefined`
- **THEN** it returns the caller-supplied existing fallback host

#### Scenario: Host value is invalid
- **WHEN** a host reader receives a non-string or empty value
- **THEN** it raises the caller's existing host validation error

#### Scenario: Existing preview host API is used
- **WHEN** code calls `readPreviewHost`
- **THEN** the call delegates to the canonical host reader and produces the same result or error as before

### Requirement: Port readers are unified without removing preview compatibility
All production `readPort` and `readPreviewPort` behavior SHALL be backed by one canonical port-reading implementation, while the existing `readPreviewPort` export MUST retain its signature and behavior.

#### Scenario: CLI port input is read
- **WHEN** a CLI consumer supplies an integer number, numeric string, or omitted value
- **THEN** the canonical reader preserves the current conversion, fallback, range validation, and error behavior

#### Scenario: Runtime port field is asserted
- **WHEN** preview runtime data supplies a port field
- **THEN** the canonical reader accepts only an integer from 1 through 65535 and preserves the field-specific error message

#### Scenario: Existing preview port API is used
- **WHEN** code calls `readPreviewPort`
- **THEN** the call delegates to the canonical port reader and produces the same result or error as before

### Requirement: Vendor definition validation has one domain owner
`bit-lite-vendors` SHALL export the canonical `isVendorDefinition` predicate, and all production consumers SHALL use that predicate to validate `VendorDefinition` values.

#### Scenario: Compiler vendor module is validated
- **WHEN** `bit-lite-compiler` validates a compiler vendor module
- **THEN** it uses the predicate exported by `bit-lite-vendors`

#### Scenario: Vendor task module is loaded
- **WHEN** `bit-lite-vendors` loads and validates vendor metadata
- **THEN** it uses its canonical predicate and no duplicate local predicate remains

### Requirement: Production migration is complete and behavior preserving
Every selected production call site SHALL use its canonical implementation or an intentional compatibility delegate, and selected local duplicate implementations MUST be removed after migration.

#### Scenario: Source is checked for duplicates
- **WHEN** the migration is complete
- **THEN** a repository source scan finds no selected production local implementation outside `bit-lite-utils`, the canonical `bit-lite-vendors` predicate, or the documented preview compatibility delegates

#### Scenario: Private worker shutdown remains private
- **WHEN** the utility migration is applied on top of the simplified watch shutdown lifecycle
- **THEN** no public `isShutdownMessage` helper or `RunnerShutdownMessage` type is reintroduced and `isWorkerRunnerShutdownMessage` remains owned by the private worker protocol

#### Scenario: Tests and builds run
- **WHEN** the change is ready for review
- **THEN** focused utility tests, affected package tests, affected package typechecks, and workspace builds pass under pnpm

#### Scenario: Test-only helpers are inspected
- **WHEN** the production migration is performed
- **THEN** test-only helper implementations remain unchanged unless an import update is strictly required by production API movement

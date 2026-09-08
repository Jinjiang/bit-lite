## MODIFIED Requirements

### Requirement: Selected generic utilities have canonical implementations
`bit-lite-utils` SHALL provide canonical implementations for `isRecord`, `isInteractiveTerminal`, `isNodeErrorCode`, `isJsonObject`, `sanitizeFileName`, `createComponentFileMap`, `formatExitCode`, `isFile`, `isFileUrl`, `listen`, `normalizeFilePath`, `readStringRecord`, `replaceExtension`, `sortStringRecord`, `toPosixPath`, `throwCombinedErrors`, `formatError`, `isJsonValue`, `collectFiles`, `readHost`, `readPort`, `escapeHtml`, `isPortUnavailableError`, `readDefaultExport`, `readJsonFile`, `readPackageName`, `sendHtml`, `BitLiteError`, and `formatPatch`.

`BitLiteError` SHALL have exactly one declaration in the workspace. A package needing the user-facing error type SHALL import it rather than declare an equivalent class, so the number of declarations cannot grow as packages are added.

#### Scenario: Equivalent helper is consumed
- **WHEN** a production package needs one of the selected helpers whose existing implementations are equivalent
- **THEN** the package imports the canonical implementation instead of declaring another local implementation

#### Scenario: Consumer-owned types are involved
- **WHEN** a selected utility operates on vendor, compiler, preview, context, or demo-vendor data
- **THEN** the utility uses structural generics or callbacks without making `bit-lite-utils` depend on the consumer package

#### Scenario: A new package needs the user-facing error type

- **WHEN** a package is added that raises errors intended for direct display to a user
- **THEN** it imports `BitLiteError` from `bit-lite-utils`
- **AND** no package declares a second equivalent error class

#### Scenario: Patch text is produced

- **WHEN** production code serializes the difference between two component file sets as a unified diff
- **THEN** it uses the canonical patch formatter rather than a local serializer

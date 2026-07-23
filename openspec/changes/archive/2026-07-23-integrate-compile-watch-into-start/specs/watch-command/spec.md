## ADDED Requirements

### Requirement: Watch is a strict compile-watch alias
The CLI SHALL register top-level `bit-lite watch` as a strict alias for the existing standalone `bit-lite compile --watch` workflow. The alias SHALL invoke the same compile-watch runner and contribution path rather than copying workspace preparation, selection, planning, task creation, supervision, terminal, signal, or cleanup behavior. It SHALL force effective command `options.watch` to `true` and SHALL never run one-shot compilation.

#### Scenario: Watch is dispatched
- **WHEN** a user runs `bit-lite watch`
- **THEN** the CLI invokes the same resident compile-watch workflow used by `bit-lite compile --watch` with effective watch mode enabled

#### Scenario: Explicit watch is redundant
- **WHEN** a user runs `bit-lite watch --watch`
- **THEN** the alias accepts the redundant true value and runs the same compile-watch workflow once

#### Scenario: Negative watch conflicts with the alias
- **WHEN** a user runs `bit-lite watch --no-watch`
- **THEN** the CLI rejects the conflicting input before workspace preparation and does not fall back to one-shot compile

### Requirement: Watch preserves user arguments and global selection
When the alias forces effective watch mode, it SHALL preserve the user's original raw argument array, every other named command option, passthrough values and ordering, parsed workspace root, and repeated component filters. It MUST NOT mutate the source parsed arguments. The `-w` short option SHALL retain its existing meaning as `--workspace`; the alias SHALL introduce no short watch option.

#### Scenario: Filters and workspace are supplied
- **WHEN** a user runs `bit-lite watch -w <dir> --filter <one> --filter <two>`
- **THEN** compile watch uses that workspace and both component filters and interprets `-w` only as `--workspace`

#### Scenario: Vendor arguments are supplied
- **WHEN** a user runs `bit-lite watch --custom value -- --vendor-option payload`
- **THEN** the compiler vendor receives the preserved custom option and passthrough values, effective `options.watch` is true, and raw arguments retain the original `watch` spelling

#### Scenario: Alias normalization is non-mutating
- **WHEN** CLI dispatch derives effective compile-watch arguments from a parsed `watch` invocation
- **THEN** the original parsed command, options, raw arguments, passthrough, workspace, and filters remain unchanged

### Requirement: Watch is documented as an alias
CLI help and the `bit-lite` README SHALL list `watch` as an alias for `compile --watch`, SHALL show that it accepts the same workspace, filter, command-option, and passthrough forms, and SHALL state that `--no-watch` conflicts with the command. Documentation MUST NOT describe `-w` as a watch flag.

#### Scenario: User reads CLI help
- **WHEN** a user runs `bit-lite --help`
- **THEN** the command list identifies `watch` as the compile-watch alias without changing the documented `--workspace` shorthand

#### Scenario: User reads command documentation
- **WHEN** a user consults the `bit-lite` README
- **THEN** examples and prose explain alias equivalence, argument preservation, and rejection of `--no-watch`

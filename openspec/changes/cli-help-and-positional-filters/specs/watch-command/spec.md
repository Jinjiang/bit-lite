## MODIFIED Requirements

### Requirement: Watch is documented as an alias
CLI help and the `bit-lite` README SHALL list `watch` as an alias for `compile --watch`, SHALL show that it accepts the same workspace, filter, positional component pattern, command-option, and passthrough forms, and SHALL state that `--no-watch` conflicts with the command. Documentation MUST NOT describe `-w` as a watch flag. The global command list SHALL carry the alias summary, and `bit-lite watch -h`, `bit-lite watch --help`, and `bit-lite help watch` SHALL each state the alias relationship and list the options `compile` accepts.

#### Scenario: User reads CLI help
- **WHEN** a user runs `bit-lite --help`
- **THEN** the command list identifies `watch` as the compile-watch alias without changing the documented `--workspace` shorthand

#### Scenario: User reads the watch command's own help
- **WHEN** a user runs `bit-lite watch -h`
- **THEN** the output states that `watch` is `compile --watch`, lists the options `compile` accepts, offers a positional component pattern, and notes that `--no-watch` conflicts with the command

#### Scenario: User reads command documentation
- **WHEN** a user consults the `bit-lite` README
- **THEN** examples and prose explain alias equivalence, argument preservation, and rejection of `--no-watch`

## ADDED Requirements

### Requirement: Watch accepts positional component patterns like the command it aliases
The `watch` command SHALL accept positional component patterns with the same meaning `compile` gives them, and alias normalization SHALL carry the resulting component filters through unchanged.

#### Scenario: Watch selects a component positionally
- **WHEN** a user runs `bit-lite watch ui/button`
- **THEN** the derived compile-watch invocation selects the same components as `bit-lite compile --watch --filter ui/button`, and the original parsed command, options, raw arguments, passthrough, workspace, and filters remain unchanged

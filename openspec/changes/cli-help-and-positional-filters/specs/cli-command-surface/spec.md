## ADDED Requirements

### Requirement: Every command is declared in one table
The CLI SHALL describe each command in a single declaration carrying its name, a one-line summary, a longer description, whether it selects components, whether undeclared options are forwarded to a vendor or rejected, its options with each option's spelling and whether that option takes a value, and its examples. Help rendering and argument parsing SHALL both read that declaration; neither SHALL maintain a second list of the same options. Global options — `--workspace`/`-w`, `--filter`, and `--help`/`-h` — SHALL be declared once and apply to every command.

#### Scenario: An option is declared once and used twice
- **WHEN** a command declares an option that takes no value
- **THEN** the parser treats a following bare word as a component pattern rather than that option's value, and the command's help lists the option with its description

#### Scenario: Every command carries complete declaration text
- **WHEN** the declaration table is inspected
- **THEN** every registered command has a non-empty summary and description, and every declared option has a non-empty description

### Requirement: Each command has its own help
The CLI SHALL print help for a single command when the user runs `<command> -h`, `<command> --help`, or `help <command>`. All three spellings SHALL produce identical text containing the command's synopsis, its description, its own options together with the global options, and its examples. A help request SHALL be resolved before the command is dispatched, so the command SHALL NOT run. Help SHALL be written to standard output and the process SHALL exit with code 0.

#### Scenario: A command's help is requested with a flag
- **WHEN** a user runs `bit-lite tag -h`
- **THEN** the output describes `tag` — including `--interactive`, `--version`, `--message`, `--dry-run`, and `--json` — no component is tagged, no ref moves, and the exit code is 0

#### Scenario: A command's help is requested through the help command
- **WHEN** a user runs `bit-lite help tag`
- **THEN** the output is identical to the output of `bit-lite tag --help`

#### Scenario: Help wins over an argument the command would reject
- **WHEN** a user runs `bit-lite snap --dryrun -h`
- **THEN** `snap`'s help is printed and the undeclared option is not reported as an error

#### Scenario: A synopsis reflects whether the command selects components
- **WHEN** a user compares `bit-lite snap -h` with `bit-lite install -h`
- **THEN** the `snap` synopsis offers a positional component pattern and the `install` synopsis does not

### Requirement: The global help lists every command
The CLI SHALL print a list of every command with its one-line summary when the user runs `bit-lite`, `bit-lite -h`, `bit-lite --help`, or `bit-lite help`. That list SHALL be rendered from the declaration table rather than from hand-maintained text, and SHALL NOT expand any command's options. Asking for help about a command that does not exist SHALL fail with a diagnostic naming the available commands, SHALL write to standard error, and SHALL exit with code 1.

#### Scenario: The command list is requested
- **WHEN** a user runs `bit-lite --help`
- **THEN** every registered command appears exactly once with its summary, and no command's individual options are listed

#### Scenario: Help is requested for an unknown command
- **WHEN** a user runs `bit-lite help nope`
- **THEN** the diagnostic names `nope` as unknown, lists the available commands, and the exit code is 1

### Requirement: Component-selecting commands accept positional patterns
A command declared as selecting components SHALL accept component patterns as positional arguments, and each positional pattern SHALL contribute to the component selection exactly as a `--filter` value with the same text. Positional patterns and explicit `--filter` values SHALL combine as a union and MAY appear in the same invocation in any order. Positional patterns SHALL use the pattern syntax `--filter` already accepts, with no additional syntax. Positional patterns SHALL be consumed into the parsed component filters and SHALL NOT appear as a positional field in the parsed argument record any vendor receives.

#### Scenario: A component is selected without naming the option
- **WHEN** a user runs `bit-lite snap ui/button`
- **THEN** the selection is identical to the selection produced by `bit-lite snap --filter ui/button`

#### Scenario: Several patterns are supplied positionally
- **WHEN** a user runs `bit-lite status "ui/**" lib/math`
- **THEN** both patterns select components exactly as two repeated `--filter` options would

#### Scenario: Positional patterns and an explicit filter are mixed
- **WHEN** a user runs `bit-lite compile ui/button --filter lib/math`
- **THEN** the selection is the union of both patterns and neither spelling takes precedence

#### Scenario: Positional patterns never reach a vendor as positionals
- **WHEN** a user runs `bit-lite compile ui/button -- --vendor-option`
- **THEN** the vendor receives `--vendor-option` as passthrough, the parsed arguments carry no positional field, and `ui/button` is present only as a component filter

#### Scenario: Vendor passthrough is unaffected by positional selection
- **WHEN** a user runs `bit-lite test ui/button -- --reporter json`
- **THEN** `ui/button` selects a component and every argument after `--` reaches the vendor unchanged

### Requirement: Commands that do not select components reject positional arguments
A command declared as operating on the whole workspace SHALL reject positional arguments with a diagnostic stating that the command does not select components. That diagnostic SHALL NOT direct the user to `--filter`, which those commands do not accept.

#### Scenario: A component is named to a workspace-wide command
- **WHEN** a user runs `bit-lite install ui/button`
- **THEN** parsing fails stating that `install` operates on the whole workspace and does not select components, and the message does not suggest `--filter`

### Requirement: Undeclared options are forwarded or rejected per command
A command declared as forwarding undeclared options SHALL accept them and pass them to its vendors unchanged, preserving the existing raw, option, and passthrough forms. A command declared as rejecting undeclared options SHALL fail before performing any work, with a diagnostic naming the unrecognized option and listing the options the command declares. Commands that can invoke a vendor SHALL forward; commands that never reach a vendor SHALL reject.

#### Scenario: A vendor option reaches its vendor
- **WHEN** a user runs `bit-lite test --reporter verbose`
- **THEN** the option is passed to the test vendor unchanged and the CLI does not report it as unrecognized

#### Scenario: A mistyped option on a recording command fails before writing
- **WHEN** a user runs `bit-lite snap --dryrun`
- **THEN** the command fails naming `--dryrun` as unrecognized, lists `snap`'s declared options, no object is written to the store, and no ref moves

#### Scenario: A mistyped option on an inspection command fails
- **WHEN** a user runs `bit-lite status --detials`
- **THEN** the command fails naming `--detials` as unrecognized rather than reporting status with the detail flag unset

### Requirement: A bare word consumed by an undeclared option is checked against registered components
An undeclared option SHALL take an immediately following bare word as its value, so that a vendor option and its value keep working alongside positional component patterns. The CLI SHALL record each such consumption and, once the workspace is known, SHALL fail if a consumed value exactly matches a registered component ID. The diagnostic SHALL name the option, the value, and both spellings that resolve the ambiguity: writing the option with `=` to keep the value, or moving the pattern ahead of the option to select the component.

#### Scenario: A vendor option keeps its value
- **WHEN** a user runs `bit-lite test --reporter verbose ui/button`
- **THEN** the vendor receives `--reporter` with the value `verbose` and `ui/button` selects a component

#### Scenario: A component is swallowed by a valueless vendor option
- **WHEN** a user runs `bit-lite test --verbose ui/button` and `ui/button` is a registered component
- **THEN** the command fails naming `--verbose`, the consumed value `ui/button`, and both the `--verbose=<value>` and reordering spellings, rather than running with no component selected

#### Scenario: A consumed value that names no component is left alone
- **WHEN** a user runs `bit-lite test --reporter verbose` and no component is named `verbose`
- **THEN** the command proceeds and the vendor receives the option unchanged

### Requirement: Only genuinely global options are declared globally
The global option set SHALL contain exactly those options every command accepts: `--workspace`/`-w`, `--filter`, and `--help`/`-h`. An option read by some commands and not others SHALL be declared by those commands rather than globally, and SHALL therefore be unrecognized on a command that does not declare it. `--lazy` SHALL be declared by `preview` and `start` and by no other command.

#### Scenario: A per-command option is declared by the commands that read it
- **WHEN** `preview -h` and `start -h` are rendered
- **THEN** each lists `--lazy` among its own options rather than among the global options

#### Scenario: A per-command option is not accepted elsewhere
- **WHEN** a user runs `bit-lite snap --lazy`
- **THEN** the command fails naming `--lazy` as unrecognized, rather than accepting it and ignoring it

### Requirement: Every declared flag accepts the same boolean forms and rejects the same values
An option declared as taking no value SHALL accept `--<name>`, `--no-<name>`, and `--<name>=true` or `--<name>=false`, and SHALL reject any other `=value` form with one diagnostic naming that option. The rule SHALL be driven by the declared option kind for the command being run rather than by a hard-coded option name, so every declared flag behaves identically and no flag is validated only by the command that reads it.

#### Scenario: A flag is assigned a non-boolean value
- **WHEN** a user runs `bit-lite preview --lazy=sometimes`
- **THEN** parsing fails stating that `--lazy` requires a boolean value

#### Scenario: A flag accepts its boolean forms
- **WHEN** a user runs `bit-lite preview --lazy`, `bit-lite preview --no-lazy`, or `bit-lite preview --lazy=false`
- **THEN** each parses to the corresponding boolean without error

#### Scenario: Every flag accepts the forms one flag accepts today
- **WHEN** a user runs `bit-lite snap --json=true`
- **THEN** the flag is set, matching `--lazy=true`, rather than being rejected because the value arrived as a string

#### Scenario: A flag read by direct comparison is validated
- **WHEN** a user runs `bit-lite compile --watch=maybe`
- **THEN** parsing fails naming `--watch`, rather than compiling once without watching and reporting success

#### Scenario: One diagnostic replaces the per-command spellings
- **WHEN** a user assigns a non-boolean value to `--json`, `--dry-run`, `--interactive`, `--detail`, or `--compile`
- **THEN** each fails with the same diagnostic shape naming the option, rather than with the command-specific wording each reader uses today

### Requirement: Help rendering is a pure function of the declarations
Rendering a command's help and rendering the command list SHALL be functions from declarations to text, requiring no workspace, no component history store, and no vendor. The rendered synopsis SHALL be derived from the declaration rather than written by hand.

#### Scenario: Help is rendered without a workspace
- **WHEN** help is rendered for any command in a directory containing no `bit-lite.json`
- **THEN** the text is produced without reading the workspace and without error

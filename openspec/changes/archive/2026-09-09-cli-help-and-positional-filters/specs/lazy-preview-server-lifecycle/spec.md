## MODIFIED Requirements

### Requirement: Lazy preview execution is opt-in
The `preview` and `start` commands SHALL accept a boolean `--lazy` option that defers preview vendor execution while retaining eager workspace resolution and preview input preparation. Without `--lazy`, every successfully prepared preview logical task SHALL activate immediately and preserve existing eager behavior. With `--lazy`, successfully prepared preview logical tasks SHALL remain idle until preview traffic activates them. `start --lazy` MUST NOT defer configured test watch tasks. `--lazy` SHALL be an option of `preview` and `start` alone: it SHALL be declared by those two commands rather than as a global option, and SHALL be unrecognized on every other command.

#### Scenario: Standalone preview uses lazy execution
- **WHEN** a user runs `bit-lite preview --lazy` with several successfully prepared preview envs
- **THEN** the command keeps one idle logical preview task per env without starting their workers or dev servers

#### Scenario: Start keeps tests eager
- **WHEN** a user runs `bit-lite start --lazy` for an env with preview and test services
- **THEN** the preview logical task remains idle while the test watch task starts immediately

#### Scenario: Lazy option is omitted
- **WHEN** a user runs `preview` or `start` without `--lazy`
- **THEN** every successfully prepared preview logical task activates immediately with the existing public preview behavior

#### Scenario: Lazy is offered only by the commands that implement it
- **WHEN** the help for `preview` and `start` is compared with the help for any other command
- **THEN** only `preview` and `start` list `--lazy`, and the global option list does not contain it

#### Scenario: Lazy is supplied to a command that does not implement it
- **WHEN** a user runs `bit-lite snap --lazy`
- **THEN** the command fails naming `--lazy` as unrecognized rather than parsing it as a boolean and ignoring it

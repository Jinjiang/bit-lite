## ADDED Requirements

### Requirement: Maintained compile watch exposes human-readable terminal output
For every initial or subsequent compile attempt in watch mode, maintained compiler vendors SHALL write a concise progress message and successful-completion message to stdout, and both messages SHALL identify the component. When a watched compilation fails, the vendor SHALL write a component-identified failure message and the full formatted diagnostic to stderr. Watcher-level errors SHALL likewise write a component-identified diagnostic to stderr. These raw writes SHALL be additive to the existing structured status, result, and error messages, which SHALL remain authoritative for orchestration; core SHALL NOT parse raw terminal output as task state or a compile result.

Worker-backed compile watch execution SHALL preserve stdout and stderr through the existing task raw-output buffer so retained output is available when a terminal consumer attaches after an event as well as while it is attached. A failed rebuild SHALL keep the watcher active, and a later successful rebuild SHALL emit normal success output and a validated structured result on the same task. This requirement SHALL apply only to watch mode and SHALL NOT add progress output to one-shot compilation.

#### Scenario: Initial watch compilation succeeds
- **WHEN** a maintained compiler vendor starts watch mode for a component and its initial compilation succeeds
- **THEN** stdout contains component-identified progress and successful-completion messages and the vendor emits its existing structured status and validated result messages

#### Scenario: Component terminal opens after initial compilation
- **WHEN** the initial watch compilation has produced stdout before a user opens that component's managed terminal
- **THEN** the retained progress and success output is replayed from the task raw-output buffer instead of presenting an empty terminal

#### Scenario: Watched compilation fails
- **WHEN** an input change triggers a maintained watch compilation that throws a formatted compiler diagnostic
- **THEN** stderr contains the component identity and full diagnostic, the vendor emits a structured task error, and the watcher remains active without emitting a success message for that attempt

#### Scenario: Watched compilation recovers
- **WHEN** a user corrects the input after a failed watched compilation
- **THEN** the same task writes progress and successful-completion output to stdout and emits a new validated structured result

#### Scenario: Watch infrastructure reports an error
- **WHEN** the maintained watch implementation receives a watcher-level error
- **THEN** stderr identifies the component and includes the formatted watcher diagnostic while the vendor also emits its existing structured error message

#### Scenario: One-shot compilation runs
- **WHEN** a maintained compiler vendor runs with watch disabled
- **THEN** this requirement adds no progress or completion output to that one-shot execution

## MODIFIED Requirements

### Requirement: Child commands provide non-blocking watch contributions
Preview and test command modules SHALL expose non-blocking contribution entry points that accept an already resolved command selection and return their stable logical watch tasks, service routes and read models when applicable, and one cached aggregate `dispose(): Promise<void>` operation. The contribution disposer SHALL stop every logical task created by that contribution before attempting to detach contribution listeners and release every auxiliary resource, and every repeated call SHALL return the same completion promise. A cleanup failure MUST NOT prevent the contribution from attempting its remaining owned cleanup. A preview contribution MAY return idle tasks only when deferred activation was explicitly selected; test tasks and eager preview tasks SHALL be started before their contribution returns. A contribution MUST NOT prepare or reselect the workspace, create a managed terminal, install its own long-lived process shutdown owner, or open a listening public proxy server.

#### Scenario: Start obtains eager preview and test contributions
- **WHEN** start invokes preview and test contribution entry points without lazy preview
- **THEN** each entry point returns control with its started tasks, resources, and complete aggregate disposer available for central composition

#### Scenario: Start obtains a lazy preview contribution
- **WHEN** start invokes the preview contribution with lazy preview enabled
- **THEN** it receives stable idle preview tasks plus their activation-capable routes, read model, and a disposer that stops them without activating them

#### Scenario: Preview is invoked directly
- **WHEN** a user runs `bit-lite preview` with or without lazy execution
- **THEN** the standalone preview wrapper uses the preview contribution and provides its terminal, proxy shell, manifest, preview routes, activation behavior, and root signal ownership

#### Scenario: Test watch is invoked directly
- **WHEN** a user runs `bit-lite test --watch` in an interactive terminal
- **THEN** the standalone test wrapper uses the test contribution and provides its managed terminal and root signal ownership

#### Scenario: A child contribution is disposed programmatically
- **WHEN** a caller disposes a preview or test contribution without terminating the host process
- **THEN** that contribution stops every task it created and releases its remaining owned resources exactly once

#### Scenario: Child contribution disposal is requested repeatedly
- **WHEN** startup rollback, root supervision, and caller cleanup dispose the same preview or test contribution
- **THEN** every caller receives the contribution's cached completion promise and observes the same completion or failure

### Requirement: Start centrally owns terminal supervision
Start SHALL be the only root signal and managed-terminal owner for its composed preview and test session. It SHALL place every contributed logical task in at most one `ManagedTerminal`, including idle lazy preview tasks, and child contributions MUST NOT create additional managed terminals or signal handlers. Combined task identifiers MUST derive service identity from the task's `VendorContext`, include the selected env key and loaded vendor, and be unique across service, env, and vendor. The terminal SHALL preserve one item and output buffer as an idle preview task activates, SHALL attach interactive input only when the underlying worker exists, and SHALL use Ctrl+C as its only user-triggered termination key.

#### Scenario: Lazy preview and test tasks share an interactive session
- **WHEN** start has idle preview tasks and eager test tasks and its input and output are TTYs
- **THEN** one managed terminal lists every task, shows the idle preview state, and allows attachment only to tasks whose workers are available

#### Scenario: Preview task activates
- **WHEN** traffic activates an idle preview task listed in the terminal
- **THEN** the same terminal item transitions through starting to ready and retains output from its one underlying worker

#### Scenario: Start runs without a TTY
- **WHEN** start runs with non-interactive process streams
- **THEN** it keeps eager and idle contributed watch tasks alive without creating an interactive managed terminal

#### Scenario: Q is typed in the start menu
- **WHEN** a user types `q` while the central start terminal is showing its task menu
- **THEN** start remains active and does not dispose either child contribution

#### Scenario: Start receives a supported termination signal
- **WHEN** the user types Ctrl+C or the start process receives SIGINT or SIGTERM
- **THEN** one coordinated shutdown path restores terminal state, disposes each child contribution, and closes the proxy in dependency order
- **AND** start does not independently stop the task list before or after contribution disposal

### Requirement: Start isolates expected child failures and cleans up partial startup
An expected skip or per-env preview preparation failure SHALL remain visible in central state without stopping unrelated valid tasks. If contribution construction or route registration fails unexpectedly, start MUST invoke the cached disposer of every contribution already created before closing the central server and propagating the failure. A rejection from one contribution disposer MUST NOT prevent start from disposing another created contribution or closing the central server. Start SHALL wait for every required cleanup attempt and propagate the initiating failure together with any cleanup failures after cleanup settles. Start MUST NOT separately stop tasks owned by those contributions.

#### Scenario: One preview env fails preparation
- **WHEN** one preview env fails preparation while another preview or test task is valid
- **THEN** start exposes the failed env state and continues running the valid tasks

#### Scenario: Second contribution fails during startup
- **WHEN** one contribution has started tasks and a later contribution throws during construction
- **THEN** start disposes the earlier contribution so it stops its tasks and releases its resources, closes the central server, and returns the startup error

#### Scenario: Route registration fails after contributions start
- **WHEN** preview and test contributions have started tasks but registering a route fails unexpectedly
- **THEN** start disposes both contributions so they stop their tasks and detach their listeners, closes the central server, and returns the registration error

#### Scenario: One child disposer rejects during cleanup
- **WHEN** start cleanup encounters a rejection while disposing one created child contribution
- **THEN** start still disposes every other created contribution and closes the central server before reporting the combined cleanup failure

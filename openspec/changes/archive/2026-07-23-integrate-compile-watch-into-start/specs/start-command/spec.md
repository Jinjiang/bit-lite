## MODIFIED Requirements

### Requirement: Start composes preview and test services for one selection
The CLI SHALL register a `start` command that prepares and resolves the workspace once, derives one filtered selection of canonical workspace components and env groups, and derives component-level compile roots plus env-level preview and test contributions from that same selection. Start SHALL include a selected component as a compile root only when its effective env configures `services.compile`; absence of compile for that component SHALL NOT suppress its preview, test, source-browser, manifest, or UI participation.

Start SHALL create the compile contribution first and wait for every included compile task's initial validated successful result/readiness before creating preview or test contributions. It SHALL create one logical watch task for every selected env with a successfully prepared preview service and one eager watch task for every selected env with a configured test service. Without `--lazy`, start SHALL activate preview tasks immediately. With `--lazy`, start SHALL leave preview tasks idle until registered preview traffic activates them. Compile and test tasks SHALL remain eager without requiring a user-supplied `--watch` option. Enabling compile/test watch or lazy preview MUST NOT mutate the shared parsed selection or discard its other command arguments.

#### Scenario: Selected components configure all three services eagerly
- **WHEN** a user runs `bit-lite start` without `--lazy` for components whose effective envs configure compile, preview, and test
- **THEN** start waits for every component-level compile task's initial successful result before it creates and activates one preview task and starts one test task for each applicable env

#### Scenario: Selected components configure all three services lazily
- **WHEN** a user runs `bit-lite start --lazy` for components whose effective envs configure compile, preview, and test
- **THEN** start waits for eager compile readiness, creates idle preview tasks, and eagerly starts every configured test task

#### Scenario: Selected component has preview or test but no compile
- **WHEN** a selected component's effective env configures preview or test but does not configure compile
- **THEN** start skips a compile task for that component and still runs or retains each available env-level service according to its lifecycle mode

#### Scenario: Component filters are supplied
- **WHEN** a user runs `bit-lite start --filter <pattern>` with or without lazy preview
- **THEN** compile root derivation and both env-level contributions use the same filtered canonical components and add no unrelated selected roots

#### Scenario: All contributions consume one prepared workspace
- **WHEN** start composes compile, preview, and test for one invocation
- **THEN** workspace linking, local-env materialization, env resolution, component selection, and env grouping occur once before contribution composition
- **AND** all contributions derive their work from the same canonical workspace and selected component objects

#### Scenario: Start enables eager services without losing arguments
- **WHEN** a user supplies `--lazy`, unknown command options, raw arguments, or passthrough arguments to `bit-lite start`
- **THEN** compile and test receive effective parsed arguments with `watch` set to true, preview alone receives lazy activation, and all other argument data remains preserved
- **AND** the shared parsed selection remains unchanged

#### Scenario: Selection is compile-only
- **WHEN** at least one selected component configures compile and no selected env configures preview or test
- **THEN** start treats the compile tasks as a valid resident session and continues to its central proxy, source browser, manifest, UI, and supervision

#### Scenario: No selected service contributes a task
- **WHEN** no selected component configures compile and no selected env configures preview or test
- **THEN** start reports that no start tasks were found and exits without opening the public proxy or entering a watch session

### Requirement: Child commands provide non-blocking watch contributions
Compile, preview, and test command modules SHALL expose non-blocking contribution entry points that accept work derived from an already resolved command selection and return their stable logical watch tasks, service routes and read models when applicable, and one cached aggregate `dispose(): Promise<void>` operation. The contribution disposer SHALL stop every logical task created by that contribution before attempting to detach contribution listeners and release every auxiliary resource, and every repeated call SHALL return the same completion promise. A cleanup failure MUST NOT prevent the contribution from attempting its remaining owned cleanup.

The compile contribution SHALL expose a cached readiness barrier covering every compile task it contributed. A preview contribution SHALL return idle tasks only when deferred activation was explicitly selected; compile tasks, test tasks, and eager preview tasks SHALL be started before their contribution returns or readiness settles as applicable. A contribution MUST NOT prepare or reselect the workspace, create a managed terminal, install its own long-lived process shutdown owner, or open a listening public proxy server.

#### Scenario: Start obtains compile before preview and test
- **WHEN** start invokes the compile contribution for its compile-enabled roots
- **THEN** it receives stable component-level tasks, bindings, the all-task readiness barrier, and the complete aggregate disposer without a terminal or signal owner

#### Scenario: Start obtains eager preview and test contributions
- **WHEN** compile readiness has succeeded and start invokes preview and test contributions without lazy preview
- **THEN** each env-level contribution returns control with its started tasks, resources, and complete aggregate disposer available for central composition

#### Scenario: Start obtains a lazy preview contribution
- **WHEN** compile readiness has succeeded and start invokes preview with lazy activation
- **THEN** it receives stable idle preview tasks plus their activation-capable routes, read model, and a disposer that stops them without activating them

#### Scenario: Compile watch is invoked directly
- **WHEN** a user runs `bit-lite compile --watch` or its strict `bit-lite watch` alias
- **THEN** the standalone compile wrapper uses the same compile contribution and provides its managed terminal policy and root signal ownership

#### Scenario: Preview is invoked directly
- **WHEN** a user runs `bit-lite preview` with or without lazy execution
- **THEN** the standalone preview wrapper uses the preview contribution and provides its terminal, proxy shell, manifest, preview routes, activation behavior, and root signal ownership

#### Scenario: Test watch is invoked directly
- **WHEN** a user runs `bit-lite test --watch` in an interactive terminal
- **THEN** the standalone test wrapper uses the test contribution and provides its managed terminal and root signal ownership

#### Scenario: A child contribution is disposed programmatically
- **WHEN** a caller disposes a compile, preview, or test contribution without terminating the host process
- **THEN** that contribution stops every task it created and releases its remaining owned resources exactly once

#### Scenario: Child contribution disposal is requested repeatedly
- **WHEN** startup rollback, root supervision, and caller cleanup dispose the same contribution
- **THEN** every caller receives the contribution's cached completion promise and observes the same completion or failure

### Requirement: Start centrally owns terminal supervision
Start SHALL be the only root signal and managed-terminal owner for its composed compile, preview, and test session. It SHALL place every contributed logical task in at most one `ManagedTerminal`, including component-level compile tasks and idle lazy preview tasks, and child contributions MUST NOT create additional managed terminals or signal handlers. Combined task identifiers MUST derive service identity from the task's `VendorContext`, include component or selected env identity as applicable, and be unique across service, unit, env, and vendor. The terminal SHALL preserve one item and output buffer as an idle preview task activates, SHALL attach interactive input only when the underlying worker exists, and SHALL use Ctrl+C as its only user-triggered termination key.

#### Scenario: Three service types share an interactive session
- **WHEN** start has eager compile tasks, idle or eager preview tasks, and eager test tasks and its input and output are TTYs
- **THEN** one managed terminal lists every task and does not create a nested standalone compile, preview, or test supervisor

#### Scenario: Preview task activates
- **WHEN** traffic activates an idle preview task listed in the terminal
- **THEN** the same terminal item transitions through starting to ready and retains output from its one underlying worker

#### Scenario: Start runs without a TTY
- **WHEN** start runs with non-interactive process streams
- **THEN** it keeps eager and idle tasks from all three contributions alive without creating an interactive managed terminal

#### Scenario: Q is typed in the start menu
- **WHEN** a user types `q` while the central start terminal is showing its task menu
- **THEN** start remains active and disposes no contribution

#### Scenario: Start receives a supported termination signal
- **WHEN** the user types Ctrl+C or the start process receives SIGINT or SIGTERM
- **THEN** one coordinated shutdown path restores terminal state, disposes preview and test before compile, and closes the proxy after contribution cleanup
- **AND** start does not independently stop the combined task list before or after contribution disposal

### Requirement: Start exposes combined preview and test navigation
The start root page and manifest SHALL describe the central proxy, live compile, preview, and test task identity/status, and selected canonical components. The manifest SHALL expose every compile task, including an included local env prerequisite, with its task ID, component ID, selected env identity, vendor, and current structured task status. A directly selected component with a compile task SHALL reference that binding, while a component skipped because it lacks compile SHALL expose no actionable compile binding.

For every selected component in the combined start manifest, the manifest SHALL include a source-browser route and the root UI SHALL expose its `source` link. For each component with preview content, the UI SHALL expose its available overview, docs, and composition links; for each component bound to a started test task, the UI SHALL expose a link to that component's read-only test page. The UI SHALL render compile identity/status as read-only state and MUST NOT expose compile controls, structured compile history, or raw terminal output as component-attributed history. Raw compile stdout/stderr SHALL remain scoped to the corresponding task in the unified terminal.

#### Scenario: Component has compile, preview, and test services
- **WHEN** the start UI renders a component bound to all three service types
- **THEN** the component exposes source, available preview links, a test-results link, and its compile task identity/status without a compile control

#### Scenario: Component has no configured compile service
- **WHEN** the start UI renders a selected component whose effective env has no compile service
- **THEN** it still exposes source and any available preview or test links and does not show a failed or actionable compile binding

#### Scenario: Required compile prerequisite was not directly selected
- **WHEN** the compile plan includes a local env prerequisite component outside the filtered selected component catalog
- **THEN** the top-level manifest exposes that prerequisite compile task's identity and status without adding it as a directly selected source-browser component

#### Scenario: Component has no configured test service
- **WHEN** the start UI renders a selected component whose env has no test service
- **THEN** it exposes the component's source link and any compile/preview state
- **AND** it does not expose an actionable test-results link for that component

#### Scenario: Component has no available preview content
- **WHEN** a selected component's preview is unavailable or contains no prepared preview entry
- **THEN** it still exposes source and any compile/test state
- **AND** it does not invent overview, docs, or composition links

#### Scenario: Source route is encoded in the manifest
- **WHEN** a component ID contains `/`, spaces, or other URL-significant characters
- **THEN** the manifest source route preserves the exact component ID through URL query encoding
- **AND** following the route resolves the selected component rather than a path segment

#### Scenario: Compile task state changes after startup
- **WHEN** a compiler reports a runtime rebuild failure or later recovery after the start readiness barrier
- **THEN** subsequent manifest reads and UI polling expose the latest structured task status without restarting the central server
- **AND** start does not parse or publish the task's raw terminal text as structured component history

### Requirement: Start isolates expected child failures and cleans up partial startup
A directly selected component's absent compile service or an env's absent preview/test service SHALL be treated as an expected skip and SHALL remain compatible with unrelated valid services. A per-env preview preparation failure SHALL remain visible in central state without stopping unrelated valid tasks. Every included compile task MUST produce an initial validated successful result before preview or test contribution creation. An unavailable, unconfigured, preparation-failed, or first-result-failed mandatory compile prerequisite SHALL reject that barrier and block dependent startup.

If compile readiness, contribution construction, proxy startup, or route registration fails unexpectedly, start MUST invoke the cached aggregate disposer covering every contribution and root resource already created before propagating the failure. A rejection from one contribution disposer MUST NOT prevent start from disposing another created contribution or closing the central server. Start SHALL wait for every required cleanup attempt and propagate the initiating failure together with any cleanup failures after cleanup settles. Start MUST NOT separately stop tasks owned by those contributions.

#### Scenario: Selected component lacks compile but has another service
- **WHEN** one selected component has no compile service but has valid preview or test work
- **THEN** start skips its compile root and continues to start the available env-level work

#### Scenario: Mandatory local env prerequisite is unavailable
- **WHEN** a compile-enabled selected component requires a local env prerequisite that is missing from the workspace or lacks its required compile service
- **THEN** start identifies the prerequisite, does not create preview or test contributions, and rolls back compile resources already created

#### Scenario: Initial compile result fails
- **WHEN** any included compile task fails before its first validated successful result
- **THEN** start does not create preview or test contributions, disposes the compile contribution, and reports the startup failure after cleanup

#### Scenario: One preview env fails preparation
- **WHEN** compile readiness has succeeded and one preview env fails preparation while another preview or test task is valid
- **THEN** start exposes the failed env state and continues running the valid tasks

#### Scenario: Later contribution fails during startup
- **WHEN** compile is ready and a preview or test contribution throws during construction
- **THEN** start disposes every previously created contribution so it stops its tasks and releases resources, closes the central server when opened, and returns the startup error

#### Scenario: Route registration fails after contributions start
- **WHEN** compile, preview, and test contributions have started tasks but registering a route fails unexpectedly
- **THEN** start disposes all three contributions, closes the central server, and returns the registration error

#### Scenario: One child disposer rejects during rollback
- **WHEN** start cleanup encounters a rejection while disposing one created contribution
- **THEN** start still attempts every other contribution and root-resource cleanup before reporting the combined initiating and cleanup failures

## ADDED Requirements

### Requirement: Compile-only start retains central presentation
When the resolved selection contributes compile tasks but no preview or test tasks, start SHALL open its central proxy and serve the normal root shell, live manifest, and read-only source browser for the selected canonical components. It SHALL supervise the compile tasks as a resident start session under the same interactive or non-interactive root lifecycle used by mixed sessions.

#### Scenario: Compile-only start opens the root UI
- **WHEN** a compile-only selection completes its initial compile readiness barrier
- **THEN** the start origin serves a manifest and root UI containing compile status and source links without requiring a preview or test contribution

#### Scenario: Compile-only start is non-interactive
- **WHEN** a compile-only start session runs without TTY streams
- **THEN** its compile tasks remain resident under the single signal owner and the central HTTP presentation remains available without a managed terminal

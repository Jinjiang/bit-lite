## MODIFIED Requirements

### Requirement: Start composes preview and test services for one selection
The CLI SHALL register a `start` command that prepares and resolves the workspace once, derives one filtered selection of canonical workspace components and env groups, and supplies that same selection to both preview and test command contributions. It SHALL create one logical watch task for every selected env with a successfully prepared preview service and one eager watch task for every selected env with a configured test service. Without `--lazy`, start SHALL activate preview tasks immediately. With `--lazy`, start SHALL leave preview tasks idle until registered preview traffic activates them while every test task still runs in watch mode without requiring a `--watch` option. Enabling test watch or lazy preview MUST NOT mutate the shared parsed selection or discard its other command arguments.

#### Scenario: Selected env configures preview and test eagerly
- **WHEN** a user runs `bit-lite start` without `--lazy` for components in an env that configures both services
- **THEN** start creates and immediately activates one preview watch task and starts one test watch task for that env

#### Scenario: Selected env configures preview and test lazily
- **WHEN** a user runs `bit-lite start --lazy` for components in an env that configures both services
- **THEN** start creates one idle preview logical task and starts one test watch task for that env

#### Scenario: Selected env configures only one service
- **WHEN** a selected env configures preview or test but not both
- **THEN** start runs or retains the configured service according to the selected lifecycle mode and reports the other service as unavailable or skipped without rejecting the configured task

#### Scenario: Component filters are supplied
- **WHEN** a user runs `bit-lite start --filter <pattern>` with or without lazy preview
- **THEN** both child contributions receive the same resolved selection and operate only on matching canonical components

#### Scenario: Both contributions consume one prepared workspace
- **WHEN** start composes preview and test for one invocation
- **THEN** workspace linking, local-env materialization, env resolution, component selection, and env grouping occur once before either contribution runs
- **AND** both contributions receive the same canonical workspace, selected component, and env-group object references

#### Scenario: Start enables test watch without losing arguments
- **WHEN** a user supplies `--lazy`, unknown command options, raw arguments, or passthrough arguments to `bit-lite start`
- **THEN** the test contribution receives an effective argument value with parsed `watch` set to true and all other argument data preserved
- **AND** the shared parsed selection remains unchanged

#### Scenario: No selected env has a start service
- **WHEN** no selected env configures either preview or test
- **THEN** start reports that no start tasks were found and exits without opening the public proxy or entering a watch session

### Requirement: Child commands provide non-blocking watch contributions
Preview and test command modules SHALL expose non-blocking contribution entry points that accept an already resolved command selection and return their stable logical watch tasks, service routes and read models when applicable, and idempotent cleanup. A preview contribution MAY return idle tasks only when deferred activation was explicitly selected; test tasks and eager preview tasks SHALL be started before their contribution returns. A contribution MUST NOT prepare or reselect the workspace, create a managed terminal, install its own long-lived process shutdown owner, or open a listening public proxy server.

#### Scenario: Start obtains eager preview and test contributions
- **WHEN** start invokes preview and test contribution entry points without lazy preview
- **THEN** each entry point returns control with its started tasks and resources available for central composition

#### Scenario: Start obtains a lazy preview contribution
- **WHEN** start invokes the preview contribution with lazy preview enabled
- **THEN** it receives stable idle preview tasks plus their activation-capable routes and read model without a preview worker having started

#### Scenario: Preview is invoked directly
- **WHEN** a user runs `bit-lite preview` with or without lazy execution
- **THEN** the standalone preview wrapper uses the preview contribution and still provides its terminal, proxy shell, manifest, preview routes, activation behavior, and shutdown ownership

#### Scenario: Test watch is invoked directly
- **WHEN** a user runs `bit-lite test --watch` in an interactive terminal
- **THEN** the standalone test wrapper uses the test contribution and still provides its managed terminal and watch shutdown behavior

### Requirement: Start centrally owns terminal supervision
Start SHALL place every contributed preview and test logical task in at most one `ManagedTerminal`, including idle lazy preview tasks, and child contributions MUST NOT create additional managed terminals. Combined task identifiers MUST derive service identity from the task's `VendorContext`, include the selected env key and loaded vendor, and be unique across service, env, and vendor. The terminal SHALL preserve one item and output buffer as an idle preview task activates, and SHALL attach interactive input only when the underlying worker exists.

#### Scenario: Lazy preview and test tasks share an interactive session
- **WHEN** start has idle preview tasks and eager test tasks and its input and output are TTYs
- **THEN** one managed terminal lists every task, shows the idle preview state, and allows attachment only to tasks whose workers are available

#### Scenario: Preview task activates
- **WHEN** traffic activates an idle preview task listed in the terminal
- **THEN** the same terminal item transitions through starting to ready and retains output from its one underlying worker

#### Scenario: Start runs without a TTY
- **WHEN** start runs with non-interactive process streams
- **THEN** it keeps eager and idle contributed watch tasks alive without creating an interactive managed terminal

#### Scenario: Start shuts down
- **WHEN** the user quits the central terminal or the process receives a supported termination signal
- **THEN** one coordinated shutdown path stops terminal input, stops or terminates every eager, idle, activating, and ready task, detaches task and process listeners, disposes every contribution, and closes the proxy in dependency order
- **AND** every cleanup action occurs at most once and stopping an idle task does not start its worker

### Requirement: Start centrally owns a route-capable proxy server
Start SHALL open one public listening HTTP server that dispatches registered start, preview, and test routes. Preview contributions MUST provide preview-specific state, activation behavior, and HTTP/WebSocket routes without opening another public proxy server; preview vendor servers remain internal upstreams. Every successfully prepared preview env route SHALL match its complete encoded package-name namespace before an upstream exists. Any HTTP request or WebSocket upgrade in that namespace SHALL activate an idle preview task or await its existing activation, then SHALL reach the correct env server after the parent validates and installs its actual upstream port.

#### Scenario: Start launches multiple preview envs eagerly
- **WHEN** eager preview contributions report actual child server ports for multiple envs
- **THEN** the central server proxies each env's HTTP requests under its own base path

#### Scenario: Child route activates a lazy preview env
- **WHEN** any HTTP child path under a known idle preview env is requested
- **THEN** the central server waits for that env's activation and forwards the original request to its validated actual upstream

#### Scenario: Preview vendor uses WebSocket updates
- **WHEN** a real ready preview vendor constructs and upgrades its hot-update connection under a registered preview env base path
- **THEN** the central server forwards the upgrade and subsequent update traffic to that env's preview server without duplicating the base path

#### Scenario: WebSocket upgrade is the first env traffic
- **WHEN** a WebSocket upgrade reaches a known idle preview env before any HTTP request
- **THEN** the central server activates that env, awaits readiness, and forwards the original upgrade to the resulting upstream

#### Scenario: A route is not registered
- **WHEN** the central server receives HTTP or upgrade traffic that matches no start or child route
- **THEN** it returns a controlled not-found response without activating or forwarding to an arbitrary child server

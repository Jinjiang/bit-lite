## Purpose

Define how `bit-lite start` composes preview and test watch services under one resolved selection, managed terminal, central proxy, and read-only development UI.

## Requirements

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

### Requirement: Generic proxy transport is separated from service presentation
Generic proxy transport SHALL own listening lifecycle, route dispatch, response helpers, and HTTP/WebSocket forwarding without depending on preview, test, command, manifest, or UI types. Preview SHALL separately own preview state, link generation, failure messages, and standalone presentation, while start SHALL own its combined shell and manifest.

#### Scenario: Standalone preview registers presentation routes
- **WHEN** preview runs without start
- **THEN** its wrapper registers the preview-only root and manifest alongside the same preview service routes used by start
- **AND** every manifest env entry retains its structured `env` identity without an `envName` alias
- **AND** the standalone manifest does not gain a top-level `skipped` field

#### Scenario: Start registers presentation routes
- **WHEN** start runs with a preview contribution
- **THEN** preview contributes env service routes while start registers the root and combined manifest routes

### Requirement: Start preserves selected env identity and inherited service origin
Start task summaries, combined manifest entries, and test-result responses SHALL identify an env with the selected task context's structured `packageName`, `requestedVersion`, and `installedVersion`. They MUST NOT substitute a display-only env name or the package that declared an inherited service. Vendor and service-config resolution SHALL continue to use the resolved declaring service source.

#### Scenario: Start publishes env identity
- **WHEN** start exposes a preview task, test task, or component test result
- **THEN** the public record contains the structured selected env identity from its task context
- **AND** it does not expose `envName` as an alternate identity field

#### Scenario: Selected child env inherits a service
- **WHEN** a selected child env uses a preview or test service declared by a parent env package
- **THEN** vendor and configuration resolution use the parent declaring service source
- **AND** task identity, manifest state, and result state continue to identify the selected child env

### Requirement: Start exposes combined preview and test navigation
The start root page and manifest SHALL describe the central proxy, selected service tasks with structured env identity, and selected canonical components. For every component in the combined start manifest, the manifest SHALL include a source-browser route and the root UI SHALL expose its `source` link. For each component with preview content, the UI SHALL expose its available overview, docs, and composition links; for each component bound to a started test task, the UI SHALL expose a link to that component's read-only test page.

#### Scenario: Component has preview and test services
- **WHEN** the start UI renders a component whose env configures both services
- **THEN** the component exposes its source link, available preview links, and test-results link

#### Scenario: Component has no configured test service
- **WHEN** the start UI renders a component whose env has no test service
- **THEN** it exposes the component's source link
- **AND** it does not expose an actionable test-results link for that component

#### Scenario: Component has no available preview content
- **WHEN** the start UI renders a selected component whose preview is unavailable or contains no prepared preview entry
- **THEN** it still exposes the component's source link
- **AND** it does not invent overview, docs, or composition links

#### Scenario: Source route is encoded in the manifest
- **WHEN** a component ID contains `/`, spaces, or other URL-significant characters
- **THEN** the manifest source route preserves the exact component ID through URL query encoding
- **AND** following the route resolves the selected component rather than a path segment

#### Scenario: Task state changes after startup
- **WHEN** a child task reports a new status, preview server, or test result
- **THEN** subsequent manifest or result reads expose the latest observed state without restarting the central server

### Requirement: Start serves a live source browser for selected components
While `bit-lite start` is running, start SHALL expose `/source?component=<component-id>` as a source-browser page, `/__bit-lite/source-files.json?component=<component-id>` as that component's current file index, and `/__bit-lite/source-file.json?component=<component-id>&path=<relative-posix-path>` as one current file snapshot. The source catalog MUST be built from the same canonical filtered component selection supplied to preview and test contributions. The index MUST identify the component and its component-relative main file and MUST return deterministically sorted component-relative POSIX file paths and sizes without exposing absolute filesystem paths.

#### Scenario: User opens a component source link
- **WHEN** the user follows a source link for a selected component
- **THEN** the source page loads that component's current file index
- **AND** it initially selects the component's main file when that file is available

#### Scenario: User selects a text source file
- **WHEN** the user selects an indexed UTF-8 text file at or below the content limit
- **THEN** the file route returns the current complete content together with the component ID, relative path, size, `text` kind, and UTF-8 encoding
- **AND** the page renders the path and content as text rather than executable HTML

#### Scenario: Files change while start remains running
- **WHEN** a selected component file is edited, added, or removed after start has launched
- **THEN** a subsequent index or content request reflects the current filesystem state without restarting start
- **AND** a removed requested file produces a controlled unavailable response rather than stale content

#### Scenario: Source page navigation is preserved
- **WHEN** the user chooses a nested file and then reloads or uses browser back and forward navigation
- **THEN** the source page uses its `path` query parameter to restore the requested component-relative file selection when it remains available

### Requirement: Start source routes enforce a bounded component boundary
Start SHALL resolve component IDs only through its canonical selected-component source catalog and SHALL resolve file paths only through a freshly enumerated safe index for that component. Enumeration MUST prune `.git`, `.bit-lite`, `node_modules`, `dist`, `build`, and `coverage` directories at every depth and MUST NOT list or traverse symbolic links. A content read MUST revalidate that the opened entry is a regular non-symbolic-link file whose real path remains within the selected component's real root. Source routes MUST NOT accept writes, execute content, expose arbitrary workspace paths, or reveal absolute paths in successful or error responses.

#### Scenario: An unselected component is requested
- **WHEN** a request names a workspace component excluded by the current component filters or an unknown component ID
- **THEN** the source page and data routes return a controlled not-found response
- **AND** they do not read from that component's root

#### Scenario: A path attempts to escape the component
- **WHEN** a file request supplies an absolute path, backslash path, traversal segment, non-indexed path, or path through a symbolic link
- **THEN** start rejects the request without returning file content or filesystem location details

#### Scenario: Ignored and linked entries are indexed
- **WHEN** a selected component contains a pruned directory or a symbolic-link file or directory
- **THEN** the file index omits that entry and every descendant reachable only through it

#### Scenario: A text file exceeds the content limit
- **WHEN** an indexed regular file exceeds 1,048,576 bytes
- **THEN** the content route returns a successful `too-large` state with the limit and file metadata
- **AND** it returns no full or partial file content

#### Scenario: A file is not valid UTF-8 text
- **WHEN** an indexed file is invalid UTF-8 or contains NUL data within the bounded read
- **THEN** the content route returns a successful `binary` state with file metadata and no content

#### Scenario: A source route receives a write method
- **WHEN** a client sends a non-GET request to a source page or data route
- **THEN** start returns method-not-allowed with `Allow: GET`
- **AND** no filesystem state changes

#### Scenario: A source request is incomplete
- **WHEN** a source request omits a required component or file-path query parameter
- **THEN** start returns a controlled bad-request response without a raw filesystem error

### Requirement: Component test pages show the latest component result
For a requested component, start SHALL first resolve the component's binding to its actual started test task, then return the most recent stored test event whose `taskId` matches that task and that contains a structured result for the component. The response and UI SHALL obtain structured env identity, vendor, and task status from the bound task; identify the result's observation time, run number, files, statistics, duration, and errors; and describe it as the latest observed update rather than a guaranteed complete test snapshot.

#### Scenario: Latest env event contains the component
- **WHEN** the newest test event for the component's env contains that component result
- **THEN** the component page displays that structured result

#### Scenario: Newer incremental env event omits the component
- **WHEN** a newer env event omits the requested component but an older event contains it
- **THEN** the component page retains the newest stored result that actually contains the requested component and its original observation time

#### Scenario: A newer result belongs to another task
- **WHEN** the result store contains a newer event with the requested component ID but its `taskId` differs from the component's bound test task
- **THEN** the component page ignores that event and uses the newest matching event from the bound task

#### Scenario: No component result has arrived
- **WHEN** the component belongs to a running test task but no stored event contains it yet
- **THEN** the component page shows a controlled pending or empty-result state

#### Scenario: Unknown or untested component is requested
- **WHEN** a test page or data route requests a component that is not assigned to a configured test task
- **THEN** start returns a controlled not-found or unavailable response

### Requirement: Component test pages show honest env-level terminal output
The component test page SHALL show the bounded plain-text output of the component's env-level test task. The UI MUST state that this output may contain other components in the same env and that it reflects the latest available terminal output; it MUST NOT claim that the text has been attributed exclusively to the requested component.

#### Scenario: Env task emits output for several components
- **WHEN** a test task covering several components emits terminal output
- **THEN** every covered component page may show the same env-level output together with the scope notice

#### Scenario: Output arrives before a structured result
- **WHEN** the env task has emitted terminal text but no structured result exists for the requested component
- **THEN** the component page shows the available terminal text alongside the pending structured-result state

#### Scenario: Terminal output exceeds its retention limit
- **WHEN** the underlying task output buffer evicts older chunks
- **THEN** the component page shows the currently retained output without reconstructing or claiming access to evicted text

### Requirement: Test routes remain read-only
Start SHALL expose no UI control or HTTP route that requests a test rerun, and the change MUST NOT require tester-specific control messages, action metadata, or rerun capability negotiation.

#### Scenario: User opens a component test page
- **WHEN** the page renders current test results and terminal output
- **THEN** it contains no rerun button or other state-changing test control

#### Scenario: Test data routes are inspected
- **WHEN** a client accesses the start test-result routes
- **THEN** supported routes retrieve current state using read-only requests and none triggers tester execution

### Requirement: Start isolates expected child failures and cleans up partial startup
An expected skip or per-env preview preparation failure SHALL remain visible in central state without stopping unrelated valid tasks. If contribution construction or route registration fails unexpectedly, start MUST stop and dispose resources already created before propagating the failure.

#### Scenario: One preview env fails preparation
- **WHEN** one preview env fails preparation while another preview or test task is valid
- **THEN** start exposes the failed env state and continues running the valid tasks

#### Scenario: Second contribution fails during startup
- **WHEN** one contribution has started tasks and a later contribution throws during construction
- **THEN** start stops the earlier tasks before disposing their contribution resources, closes the central server, and returns the startup error

#### Scenario: Route registration fails after contributions start
- **WHEN** preview and test contributions have started tasks but registering a route fails unexpectedly
- **THEN** start stops all started tasks, detaches their listeners, disposes both contributions, closes the central server, and returns the registration error

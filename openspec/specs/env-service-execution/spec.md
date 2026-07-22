## Purpose

Define the JSON-safe test, preview, and compile service protocol, command orchestration, compile boundaries, vendor execution, and structured selected-env identity.

## Requirements

### Requirement: Env definitions support three vendor-backed services
`EnvDefinition.services` SHALL accept only `test`, `preview`, and `compile`. Each present service SHALL contain a non-empty vendor specifier and optional recursively JSON-safe `config`; it SHALL NOT contain execution mode, selected components, workspace root, component root, generic targets, callbacks, or loaded modules. Compile config SHALL remain vendor-specific and SHALL NOT imply one compiler implementation or tsconfig shape.

#### Scenario: JSON env defines all supported services
- **WHEN** an exported JSON definition contains valid test, preview, and compile services
- **THEN** env validation retains all three service definitions

#### Scenario: Env defines an unknown service
- **WHEN** an env JSON contains a `deploy` service
- **THEN** env validation fails and lists the three supported service names

#### Scenario: Env embeds execution state
- **WHEN** a service definition contains a static `mode`, `components`, or `rootDir` field
- **THEN** env validation rejects the field rather than treating it as vendor config

#### Scenario: Env declares generic targets
- **WHEN** a service definition contains a generic `targets`, `files`, or `patterns` field
- **THEN** env validation rejects the field because file discovery is not part of the shared env service contract

#### Scenario: Two compile vendors use different config shapes
- **WHEN** one env's compile config contains an inline TypeScript configuration and another env selects a non-TypeScript vendor with different JSON config
- **THEN** shared validation accepts both JSON-safe configs without imposing a common compiler schema

### Requirement: File discovery remains service-owned
Env definitions SHALL NOT declare generic file or pattern targets. Commands SHALL continue passing their selected component descriptors to the service vendor, and each service/vendor SHALL remain responsible for discovering its applicable files. The maintained test vendors SHALL retain their current hard-coded test/spec patterns; configurable target discovery is outside this change.

#### Scenario: Test runs with selected components
- **WHEN** the test command supplies selected component descriptors to a maintained test vendor
- **THEN** the vendor discovers test files with its built-in test/spec patterns without reading target patterns from the env definition

#### Scenario: Component filter excludes a component
- **WHEN** command selection excludes a component before a vendor task is created
- **THEN** the vendor receives no descriptor for that component and therefore does not discover its files

### Requirement: Service commands consume each component's effective env
The `test`, `preview`, and `compile` workflows SHALL obtain vendors and default configs from every selected component's loaded effective environment. Test and preview SHALL retain command-owned result and lifecycle behavior. One-shot compile SHALL retain component runtime-dependency ordering and output-package preparation. Compile watch SHALL create vendor-owned watch tasks in prerequisite layers. No workflow SHALL select compile behavior from component kind.

#### Scenario: Compile crosses env boundaries
- **WHEN** a component depends on a component owned by a different env package
- **THEN** compile starts or finishes the dependency with its configured vendor/config before invoking the consumer with the consumer's configured vendor/config

#### Scenario: Components use different TypeScript configurations
- **WHEN** two ready components select envs whose compile services use the same TypeScript vendor with different configs
- **THEN** each invocation receives only its effective env's config and neither config becomes a workspace-global tsconfig

#### Scenario: Components use different compiler vendors
- **WHEN** separate components select envs with different compile vendor specifiers
- **THEN** compile resolves and runs the appropriate vendor for each component without loading one global compiler

#### Scenario: Environment component uses its assigned env
- **WHEN** an env component's assigned environment configures the maintained environment compiler
- **THEN** compile selects that vendor through the normal effective-env service path rather than through component kind

#### Scenario: Existing test and preview workflows remain stable
- **WHEN** test or preview runs after compile routing changes
- **THEN** task preparation reads the same service key from the loaded env and retains existing result validation, preview failure isolation, and shutdown behavior

#### Scenario: Selected env omits a service
- **WHEN** a command selects components whose effective env does not define that command's service
- **THEN** the command skips that env, identifies the missing service, and continues independently runnable work

#### Scenario: Selected env inherits a service
- **WHEN** a selected child env omits a service and inherits it from a parent env package
- **THEN** the command runs the inherited service under the child identity while resolving its vendor/config with reconstructed parent origin

### Requirement: Install compile stages configured env compilation before consumers
`install --compile` SHALL install runtime/development dependencies, link component packages, compile local environment components through their configured compile services, load and validate generated env definitions, and then compile consumers in dependency layers through the same one-shot planner. A failed environment compile or definition load SHALL prevent components using that env from entering compile execution. Install SHALL NOT start compiler watch tasks.

#### Scenario: Clean install contains a local env
- **WHEN** a clean workspace has no generated React env artifact and a component selects the local React env
- **THEN** `install --compile` invokes the env component's configured compiler before loading the React definition and compiling its consumer

#### Scenario: One dependency layer fails
- **WHEN** a component's compile vendor fails
- **THEN** later components that depend on it do not run while independent ready work may complete and report separately

#### Scenario: Install uses environment compiler vendor
- **WHEN** an env component's assigned env points `services.compile` to `demo-vendors/compilers/env`
- **THEN** install resolves and invokes that ordinary vendor rather than a Bit-lite-owned materializer

### Requirement: Vendor context preserves stable extension inputs
Every test, preview, and compile vendor invocation SHALL receive a versioned, read-only, JSON-serializable `VendorContext`. Version 1 SHALL contain the canonical base `Workspace`, complete parsed command arguments including raw/options/passthrough forms, the structured selected-env identity, the service name, and the package location that declared the effective service. The existing version 1 type SHALL be replaced in place without a legacy positional field or a version 2 alias. Vendors SHALL tolerate unknown additive context fields. The context SHALL NOT contain parent-only lookup maps, resolver callbacks, loaded modules, or env-loader caches.

#### Scenario: Vendor reads an unknown command option
- **WHEN** a user supplies a vendor-specific option such as `--coverage` that does not affect parent orchestration
- **THEN** the selected vendor can read that option from `context.args.options` without a command-side option adapter

#### Scenario: Vendor receives watch mode
- **WHEN** compile creates a vendor watch task
- **THEN** the compiler reads `context.args.options.watch` as true through the same version 1 context

#### Scenario: Passthrough reaches a vendor
- **WHEN** arguments follow the CLI `--` separator
- **THEN** they appear in `context.args.passthrough` without being represented as positional command arguments

#### Scenario: Vendor reads base workspace declarations
- **WHEN** a vendor needs package, dependency, or configured env information for a component
- **THEN** it reads normalized declarations and canonical component metadata from `context.workspace`

#### Scenario: Inherited service receives its origin
- **WHEN** a child env invokes a service inherited from a parent env
- **THEN** `context.env` identifies the child while `context.service.source` identifies the reconstructed parent package location and entry

#### Scenario: Context crosses worker transport
- **WHEN** a vendor starts in worker or inline runner mode
- **THEN** the same version 1 serializable context is structured-cloned successfully without parent-only resolution state

### Requirement: Worker-backed watch tasks support deferred activation
The generic vendor task lifecycle SHALL allow a caller to create a worker-backed watch task in either eager or deferred mode. Eager mode SHALL remain the default. A deferred task SHALL resolve and validate its vendor metadata and expose its stable context, vendor identity, terminal state, output buffer, result lifecycle, and idempotent `activate` and `stop` operations without constructing a worker until activation. Concurrent activation calls MUST share one start operation, and a task MUST NOT activate more than once.

#### Scenario: Existing caller creates an eager watch task
- **WHEN** a caller does not request deferred activation
- **THEN** task creation starts the runner with the existing behavior

#### Scenario: Caller creates a deferred watch task
- **WHEN** a caller requests deferred activation
- **THEN** task creation returns an idle supervisable task without constructing its worker

#### Scenario: Deferred task activates concurrently
- **WHEN** several callers activate the same idle task before its runner starts
- **THEN** they observe one shared activation and exactly one worker is constructed

#### Scenario: Idle task stops
- **WHEN** coordinated shutdown stops a deferred task before activation
- **THEN** the task settles its stopped lifecycle without importing its execution target into a worker or constructing a worker

#### Scenario: Activating task stops
- **WHEN** stop races with deferred activation
- **THEN** the task records stop intent and stops or terminates the runner if activation constructs one

### Requirement: Vendor-specific config can extend from service origin
The parent SHALL resolve the vendor module and module-bearing fields required by command-owned orchestration before vendor startup. The vendor context SHALL expose a serializable declaring-service package root and entry file so vendors MAY resolve future vendor-specific config fields relative to the declaring env package without changing the main command. Any shared resolver helper used inside a vendor SHALL be a pure function of the serializable service source, specifier, and base workspace root; no resolver function SHALL cross the worker boundary.

#### Scenario: Tester adds a setup module field
- **WHEN** a tester vendor introduces a JSON config field such as `setupFile: "./setup.js"` that is not interpreted by the test command
- **THEN** the vendor can resolve it relative to `context.service.source.entryFile` and package root without the command copying or rewriting the resolved service definition

#### Scenario: Preview mounter remains command-owned
- **WHEN** preview config declares a mounter used to generate the prepared browser entry
- **THEN** the parent continues resolving and consuming that field before vendor startup because it affects command-owned preparation

### Requirement: Vendor outputs contain only produced service data
Test, preview, and compile vendor outputs SHALL contain only data produced by that vendor execution. A vendor output SHALL NOT echo the parent-owned service name, vendor identity, selected env identity, command arguments, effective config, selected component descriptors, or parent-selected output paths merely so the parent can validate equality. A preview vendor SHALL report the actual port it successfully bound because that port is produced by execution rather than selected by the parent. The parent task SHALL retain its original context, vendor metadata, host, public base path, and proxy origin and SHALL create the task result wrapper or preview server projection from that retained state plus the validated vendor output. Validators SHALL preserve additional JSON-safe vendor output fields after validating required produced fields.

#### Scenario: Test vendor reports coverage
- **WHEN** a test vendor produces normal test statistics plus a vendor-specific JSON-safe coverage result
- **THEN** the parent validates the required test output, preserves the coverage field, and attaches env/vendor/task context without requiring the vendor to echo its input

#### Scenario: Preview vendor becomes ready
- **WHEN** a preview vendor successfully binds a server using its parent-supplied host and preferred/fallback port hints
- **THEN** it reports `{ mode: "serve", port: <actual-bound-port> }` without echoing service, vendor, env, arguments, config, component descriptors, base path, proxy origin, or other parent-owned identity data

#### Scenario: Preview vendor reports an invalid port
- **WHEN** a preview vendor emits an otherwise JSON-safe result whose required actual port is missing or invalid
- **THEN** the parent rejects the preview result and does not construct an upstream server target

#### Scenario: Compile succeeds
- **WHEN** a compile vendor writes to the output directory selected by the parent
- **THEN** it may return produced artifact information or no output and is not required to echo env, component ID, service name, or output directory

#### Scenario: Vendor output uses a historical field name
- **WHEN** an otherwise valid vendor result contains an additional JSON-safe field whose name was used by an older result shape
- **THEN** validation preserves it as opaque vendor output while parent-owned context remains the source of execution identity

### Requirement: Vendor boundaries remain structured and origin-aware
Commands SHALL resolve vendor modules with valid `meta: VendorDefinition` from the effective service's declaring-package context and pass canonical module URLs to the appropriate execution boundary. Worker-facing `VendorData` SHALL contain `context: VendorContext`, selected canonical workspace components, effective prepared service config, and optional command runtime. Test, preview, and compile SHALL use the generic vendor task lifecycle. A compiler module SHALL expose the same public `meta` plus default start-function shape as other vendors; its default entry SHALL select one-shot or watch behavior from the common watch flag. One-shot compile SHALL use the generic inline runner, while compile watch SHALL use the generic worker runner. Command code SHALL validate produced run/event result shapes before presentation or storage. `bit-lite-vendors` SHALL NOT import workspace/env module-resolution implementation at runtime.

#### Scenario: Vendor module has an invalid contract
- **WHEN** a resolved vendor omits valid metadata or its required lifecycle entry
- **THEN** task creation or dispatch fails with service, selected env, declaring env, and canonical module URL before execution

#### Scenario: Worker-backed vendor starts
- **WHEN** a command starts a vendor in worker mode
- **THEN** the worker receives VendorContext, selected components, prepared config, and command runtime without a loaded env runtime, lookup map, resolver, or callback

#### Scenario: Inherited vendor service starts
- **WHEN** a child env runs a vendor service inherited from a parent env package
- **THEN** worker data identifies the selected child while vendor resolution uses the reconstructed declaring parent's package/entry origin

#### Scenario: Preview vendor starts with prepared input
- **WHEN** preview preparation has generated entry, HTML, server, and alias runtime for selected components
- **THEN** the preview vendor receives those components and prepared runtime through the generic task envelope

#### Scenario: One-shot compile vendor starts
- **WHEN** one-shot compile invokes the effective compiler for a component
- **THEN** the module's default start function receives that component, opaque config, compile-path runtime, and version 1 VendorContext through the generic inline runner with watch false

#### Scenario: Compile watch vendor starts
- **WHEN** compile watch starts the same compiler module
- **THEN** the same default start function receives the standard VendorData envelope through the generic worker runner with watch true and owns its long-running resources

#### Scenario: Vendor emits an invalid produced result
- **WHEN** a vendor returns or emits data that fails the command's produced-output validator
- **THEN** the affected operation reports a validation error and does not present or store the payload as successful output

### Requirement: Command-facing env identity remains structured end to end
Workspace env groups SHALL reuse their loaded env context and its canonical `env: { packageName, requestedVersion, installedVersion }` identity. Vendor inputs SHALL expose that identity at `VendorData.context.env`; vendors SHALL NOT echo it in produced output. Parent-owned vendor task/result context, test watch storage, prepared preview state, and preview proxy manifests SHALL derive their structured env identity from the selected env context. Internal grouping, task, temporary-file, or route keys MAY be derived from the selected package reference but SHALL NOT become a second public env identity.

#### Scenario: Test result is stored
- **WHEN** a test vendor emits valid produced output for an env requested with a range
- **THEN** the watch store obtains package name, requested version, and installed version from the parent task context and stores the vendor output without requiring an env echo

#### Scenario: Preview manifest is generated
- **WHEN** preview prepares, starts, or fails an env group
- **THEN** the proxy manifest projects the structured selected-env identity from parent preparation/task state while existing package-name-based public preview URLs remain unchanged

#### Scenario: Compile vendor receives a component
- **WHEN** ordinary-component compile invokes the compiler selected by the component's effective env
- **THEN** compiler context contains the structured selected-env identity and compiler output does not repeat it

#### Scenario: Vendor output contains envName or env
- **WHEN** a test or preview vendor returns an otherwise valid result containing additional `envName` or `env` fields
- **THEN** command validation treats those fields as opaque vendor data and continues deriving execution identity from the parent task context

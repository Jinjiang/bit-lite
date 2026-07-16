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
The `test`, `preview`, and ordinary-component `compile` workflows SHALL obtain vendors and default configs from selected components' loaded env packages. Test and preview SHALL retain command-owned result and lifecycle behavior. Compile SHALL retain component runtime-dependency ordering and output-package preparation while selecting the compile vendor and config separately for every component's effective env.

#### Scenario: Compile crosses env boundaries
- **WHEN** a component depends on a component owned by a different env package
- **THEN** compile finishes the dependency with the dependency's compile vendor/config before invoking the consumer with the consumer's compile vendor/config

#### Scenario: Components use different TypeScript configurations
- **WHEN** two ready components select envs whose compile services use the same TypeScript vendor with different configs
- **THEN** each invocation receives only its effective env's config and neither config becomes a workspace-global tsconfig

#### Scenario: Components use different compiler vendors
- **WHEN** separate components select envs with different compile vendor specifiers
- **THEN** compile resolves and runs the appropriate vendor for each component without loading one global compiler

#### Scenario: Existing test and preview workflows migrate
- **WHEN** test or preview runs after workspace inline envs are removed
- **THEN** task preparation reads the same service key from the loaded env and retains existing result validation, preview failure isolation, and shutdown behavior

#### Scenario: Selected env omits a service
- **WHEN** a command selects components whose effective env does not define that command's service
- **THEN** the command skips that env, identifies the missing service, and continues independently runnable work

#### Scenario: Selected env inherits a service
- **WHEN** a selected child env omits a service and inherits it from a parent env package
- **THEN** the command runs the inherited service under the child env identity while resolving its vendor and config modules with the parent's declaring-entry origin

### Requirement: Env components use fixed compile behavior
Compile orchestration SHALL identify registered `kind: "env"` components before loading env definitions and SHALL materialize them only with the Bit-lite-owned, non-configurable env compiler. An env component SHALL NOT be submitted to a vendor named by its own or another env's `services.compile`, and configurable compile traversal SHALL terminate at an env component package.

#### Scenario: Local env also selects an env
- **WHEN** a local React env component selects an external Node env as its development environment
- **THEN** React env materialization uses the fixed compiler rather than the Node env's compile service

#### Scenario: Env provides compile behavior to consumers
- **WHEN** the React env JSON defines or inherits `services.compile`
- **THEN** ordinary React components may use that service while the React env component itself never does

#### Scenario: Fixed env compilation fails
- **WHEN** the built-in compiler cannot parse or transpile an env component source file
- **THEN** env loading and dependent ordinary compilation stop with the env component and materialization error

### Requirement: Install compile stages env materialization before ordinary compilation
`install --compile` SHALL install component runtime/development dependencies, link component packages, materialize local env components with the fixed compiler, load and resolve JSON env definitions, and only then compile ordinary components in runtime-dependency layers. A failed env materialization or definition load SHALL prevent components using that env from entering configurable compile execution.

#### Scenario: Clean install contains a local env
- **WHEN** a clean workspace has no generated React env artifact and a component selects the local React env
- **THEN** `install --compile` generates the env JSON and support JavaScript before loading the React definition and compiling the component

#### Scenario: One dependency layer fails
- **WHEN** a component's compile vendor fails
- **THEN** later components that depend on it do not run while independent ready work may complete and report separately

### Requirement: Vendor context preserves stable extension inputs
Every test, preview, and compile vendor invocation SHALL receive a versioned, read-only, JSON-serializable `VendorContext`. Version 1 SHALL contain the canonical base `Workspace`, complete parsed command arguments including raw/options/positional/passthrough forms, the structured selected-env identity, the service name, and the package location that declared the effective service. Version 1 context fields SHALL evolve additively, and vendors SHALL tolerate unknown context fields. The context SHALL NOT contain the parent-only `WorkspaceContext`, lookup maps, resolver callbacks, loaded modules, or env-loader caches.

#### Scenario: Vendor reads an unknown command option
- **WHEN** a user supplies a vendor-specific option such as `--coverage` that does not affect parent orchestration
- **THEN** the selected test vendor can read that option from `context.args` without a new command-side option adapter

#### Scenario: Vendor reads base workspace declarations
- **WHEN** a vendor needs package, dependency, or configured env information for a workspace component
- **THEN** it can read the normalized declaration and canonical component metadata from `context.workspace` without loading `bit-lite.json` itself

#### Scenario: Inherited service receives its origin
- **WHEN** a child env invokes a service inherited from a parent env
- **THEN** `context.env` identifies the selected child while `context.service.source` identifies the parent package location and entry that declared the service

#### Scenario: Context crosses worker transport
- **WHEN** a vendor starts in worker or inline runner mode
- **THEN** the same versioned serializable context is structured-cloned successfully without parent-only resolution state

### Requirement: Vendor-specific config can extend from service origin
The parent SHALL resolve the vendor module and module-bearing fields required by command-owned orchestration before vendor startup. The vendor context SHALL expose a serializable declaring-service package root and entry file so vendors MAY resolve future vendor-specific config fields relative to the declaring env package without changing the main command. Any shared resolver helper used inside a vendor SHALL be a pure function of the serializable service source, specifier, and base workspace root; no resolver function SHALL cross the worker boundary.

#### Scenario: Tester adds a setup module field
- **WHEN** a tester vendor introduces a JSON config field such as `setupFile: "./setup.js"` that is not interpreted by the test command
- **THEN** the vendor can resolve it relative to `context.service.source.entryFile` and package root without the command copying or rewriting the resolved service definition

#### Scenario: Preview mounter remains command-owned
- **WHEN** preview config declares a mounter used to generate the prepared browser entry
- **THEN** the parent continues resolving and consuming that field before vendor startup because it affects command-owned preparation

### Requirement: Vendor outputs contain only produced service data
Test, preview, and compile vendor outputs SHALL contain only data produced by that vendor execution. A vendor output SHALL NOT echo the parent-owned service name, vendor identity, selected env identity, command arguments, effective config, selected component descriptors, or parent-selected output paths merely so the parent can validate equality. The parent task SHALL retain its original context and vendor metadata and SHALL create the task result wrapper once from that metadata plus the validated vendor output. Validators SHALL preserve additional JSON-safe vendor output fields after validating required produced fields.

#### Scenario: Test vendor reports coverage
- **WHEN** a test vendor produces normal test statistics plus a vendor-specific JSON-safe coverage result
- **THEN** the parent validates the required test output, preserves the coverage field, and attaches env/vendor/task context without requiring the vendor to echo its input

#### Scenario: Preview vendor becomes ready
- **WHEN** a preview vendor starts at server coordinates already prepared by the parent
- **THEN** readiness is reported through lifecycle/output data without echoing service, vendor, env, arguments, config, or the prepared server object as identity metadata

#### Scenario: Compile succeeds
- **WHEN** a compile vendor writes to the output directory selected by the parent
- **THEN** it may return produced artifact information or no output and is not required to echo env, component ID, service name, or output directory

#### Scenario: Vendor output uses a historical field name
- **WHEN** an otherwise valid vendor result contains an additional JSON-safe field whose name was used by an older result shape
- **THEN** validation preserves it as opaque vendor output while parent-owned context remains the source of execution identity

### Requirement: Vendor boundaries remain structured and origin-aware
Commands SHALL start vendor modules that export valid `meta: VendorDefinition` and the required entry. Parent orchestration SHALL resolve the vendor module from the effective service's declaring-package context and SHALL pass a canonical vendor module URL to the generic vendor runner. Worker-facing `VendorData` SHALL contain `context: VendorContext`, the selected canonical workspace components, the effective prepared service config, and optional command-specific runtime data. Test, preview, and compile SHALL use this same envelope, although compile MAY retain its short-lived direct entry rather than the long-running task lifecycle. Command code SHALL validate produced run/event result shapes before presenting or storing them. `bit-lite-vendors` SHALL NOT import workspace/env module-resolution implementation at runtime.

#### Scenario: Vendor module has an invalid contract
- **WHEN** a resolved vendor omits valid metadata or its required entry function
- **THEN** task creation fails with the service, selected env, declaring env, and canonical vendor module URL before execution

#### Scenario: Worker-backed vendor starts
- **WHEN** a command starts a vendor in worker mode
- **THEN** the worker receives VendorContext, selected canonical components, prepared config, and command runtime without a loaded env runtime, lookup map, config module, resolver, or callback

#### Scenario: Inherited vendor service starts
- **WHEN** a selected child env runs a vendor service inherited from a parent env package
- **THEN** worker data identifies the selected child package and both of its versions while parent-side vendor resolution retains the declaring parent's package/entry origin

#### Scenario: Preview vendor starts with prepared input
- **WHEN** preview preparation has generated entry, HTML, server, and alias runtime for selected components
- **THEN** the preview vendor receives those selected components together with the prepared runtime instead of an empty common component list

#### Scenario: Compile vendor starts
- **WHEN** ordinary compile invokes the effective compiler for one component
- **THEN** the compiler receives the same VendorContext/data envelope with that component, its opaque config, and compile-path runtime

#### Scenario: Vendor emits an invalid produced result
- **WHEN** a vendor returns data that fails the command's produced-output validator
- **THEN** the affected task reports a validation error and the command does not present or store the payload as successful output

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

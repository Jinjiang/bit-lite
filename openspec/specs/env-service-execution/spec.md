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

### Requirement: Vendor boundaries remain structured and origin-aware
Commands SHALL start vendor modules that export valid `meta: VendorDefinition` and the required entry, and SHALL pass JSON-serializable service input containing `env: { packageName, requestedVersion, installedVersion }`, selected component descriptors, CLI arguments, service config, and command-specific runtime data. Vendor loading SHALL use the effective service's declaring-package context, while command code SHALL validate run and event result shapes before presenting or storing them. Vendor task and worker contracts SHALL NOT represent selected env identity as `envName` or another package-name-only field.

#### Scenario: Vendor module has an invalid contract
- **WHEN** a resolved vendor omits valid metadata or its required entry function
- **THEN** task creation fails with the service, selected env, declaring env, and vendor specifier before execution

#### Scenario: Worker-backed vendor starts
- **WHEN** a command starts a vendor in worker mode
- **THEN** the worker receives the selected package name, requested version, and installed version with the remaining serializable service/runtime data, and no loaded env runtime, config module, resolver, or callback crosses the boundary

#### Scenario: Inherited vendor service starts
- **WHEN** a selected child env runs a vendor service inherited from a parent env package
- **THEN** worker data identifies the selected child package and both of its versions while parent-side vendor resolution retains the declaring parent's package/entry origin

#### Scenario: Vendor emits an invalid result
- **WHEN** a vendor returns data that fails the command's result formatter
- **THEN** the affected task reports a validation error and the command does not present the payload as a successful result

### Requirement: Command-facing env identity remains structured end to end
Workspace env groups SHALL reuse their loaded env runtime instead of duplicating its package name. Vendor task results, test result context, preview service results, compile vendor input, result-store entries, prepared/skipped preview state, and preview proxy manifests SHALL carry `env: { packageName, requestedVersion, installedVersion }`. Command result validation SHALL reject successful payloads that replace this structure with `envName`. Internal grouping, task, temporary-file, or route keys MAY be derived from the selected package reference but SHALL NOT become a second public env identity.

#### Scenario: Test result is stored
- **WHEN** a test vendor emits a valid result for an env requested with a range
- **THEN** the validated test result and result-store entry retain the same structured selected-env identity including the actual installed version

#### Scenario: Preview manifest is generated
- **WHEN** preview prepares, skips, starts, or fails an env group
- **THEN** prepared state and the proxy manifest expose the structured selected-env identity while existing package-name-based public preview URLs remain unchanged

#### Scenario: Compile vendor receives a component
- **WHEN** ordinary-component compile invokes the compiler selected by the component's effective env
- **THEN** compiler input contains the structured selected-env identity and no optional `envName` compatibility field

#### Scenario: Legacy service result uses envName
- **WHEN** a test or preview vendor returns an otherwise valid result containing only `envName`
- **THEN** command result validation rejects the payload as an outdated contract


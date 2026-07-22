## MODIFIED Requirements

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
- **WHEN** a clean workspace has no generated React env artifact and a component selects that local env
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

## REMOVED Requirements

### Requirement: Env components use fixed compile behavior
**Reason**: Compiler selection is now universally driven by each component's configured effective environment.
**Migration**: Assign environment components a bootstrap environment whose compile service points to the desired vendor, including `demo-vendors/compilers/env` for maintained env compilation.

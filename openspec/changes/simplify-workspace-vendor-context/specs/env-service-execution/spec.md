## ADDED Requirements

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

#### Scenario: Legacy maintained vendor echoes context
- **WHEN** a maintained vendor returns the legacy repository result shape containing echoed service/vendor/env/args/config metadata
- **THEN** contract tests reject that maintained-vendor output and require the produced-data-only shape

## MODIFIED Requirements

### Requirement: Vendor boundaries remain structured and origin-aware
Commands SHALL start vendor modules that export valid `meta: VendorDefinition` and the required entry. Parent orchestration SHALL resolve the vendor module from the effective service's declaring-package context and SHALL pass a canonical vendor module URL to the generic vendor runner. Worker-facing `VendorData` SHALL contain `context: VendorContext`, the selected canonical workspace components, the effective prepared service config, and optional command-specific runtime data. Test, preview, and compile SHALL use this same envelope, although compile MAY retain its short-lived direct entry rather than the long-running task lifecycle. Command code SHALL validate produced run/event result shapes before presenting or storing them. `bit-lite-vendors` SHALL NOT import workspace/env module-resolution implementation at runtime.

#### Scenario: Vendor module has an invalid contract
- **WHEN** a resolved vendor omits valid metadata or its required entry function
- **THEN** task creation fails with the service, selected env, declaring env, and canonical vendor module URL before execution

#### Scenario: Worker-backed vendor starts
- **WHEN** a command starts a vendor in worker mode
- **THEN** the worker receives VendorContext, selected canonical components, prepared config, and command runtime without a loaded env runtime, lookup map, config module, resolver, or callback

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
Workspace env groups SHALL reuse their loaded env context and its canonical `env: { packageName, requestedVersion, installedVersion }` identity. Vendor inputs SHALL expose that identity at `VendorData.context.env`; vendors SHALL NOT echo it in produced output. Parent-owned vendor task/result context, test watch storage, prepared/skipped preview state, and preview proxy manifests SHALL derive their structured env identity from the selected env context. Internal grouping, task, temporary-file, or route keys MAY be derived from the selected package reference but SHALL NOT become a second public env identity.

#### Scenario: Test result is stored
- **WHEN** a test vendor emits valid produced output for an env requested with a range
- **THEN** the watch store obtains package name, requested version, and installed version from the parent task context and stores the vendor output without requiring an env echo

#### Scenario: Preview manifest is generated
- **WHEN** preview prepares, skips, starts, or fails an env group
- **THEN** the proxy manifest projects the structured selected-env identity from parent preparation/task state while existing package-name-based public preview URLs remain unchanged

#### Scenario: Compile vendor receives a component
- **WHEN** ordinary-component compile invokes the compiler selected by the component's effective env
- **THEN** compiler context contains the structured selected-env identity and compiler output does not repeat it

#### Scenario: Vendor output contains envName or env
- **WHEN** a maintained test or preview vendor returns an otherwise valid produced result containing legacy `envName` or echoed `env` identity metadata
- **THEN** command contract validation rejects the output as an outdated maintained-vendor shape


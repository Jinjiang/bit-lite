## Purpose

Define configured one-shot and vendor-owned watch compilation, dependency planning, composable task contributions, optional centralized supervision, reporting, and shutdown.

## Requirements

### Requirement: Compile accepts named selection and a universal watch flag
The `compile` command SHALL accept component selection through named options such as `--filter` and SHALL expose `--watch` as a common compiler-vendor lifecycle flag. The CLI SHALL reject unsupported bare arguments after the command while preserving arguments after `--` as vendor passthrough. Parsed vendor arguments SHALL contain raw arguments, named options, and passthrough arguments without a positional field.

#### Scenario: One-shot compile is requested
- **WHEN** a user runs `bit-lite compile --filter ui/button`
- **THEN** compile selects matching components and invokes their configured compiler vendors once with watch disabled

#### Scenario: Watch compile is requested
- **WHEN** a user runs `bit-lite compile --watch --filter ui/button -- --vendor-option`
- **THEN** every selected compiler vendor receives `options.watch` as true and receives `--vendor-option` as passthrough

#### Scenario: Unsupported positional argument is supplied
- **WHEN** a user runs `bit-lite compile ui/button`
- **THEN** argument parsing fails with guidance to use `--filter` for selection or `--` for vendor passthrough

### Requirement: Compile plans configured compiler services in dependency order
Compile SHALL resolve each component's compiler from the `services.compile` definition of its effective environment without selecting a compiler from component kind. It SHALL include required local environment components in the plan, order planned components by local runtime and environment prerequisites, and invoke each component separately with its effective service config and selected-env identity.

#### Scenario: Ordinary components cross environment boundaries
- **WHEN** a selected component depends on another local component whose effective environment configures a different compiler vendor
- **THEN** the dependency finishes its configured compiler before the consumer is invoked with its own configured compiler

#### Scenario: Environment component is planned
- **WHEN** a selected component requires a local environment component whose assigned environment configures the maintained environment compiler
- **THEN** compile invokes that configured vendor through the normal service dispatcher without a component-kind compiler branch

#### Scenario: Component kind and configured compiler disagree
- **WHEN** a `kind: "env"` component's effective environment configures a valid non-default compiler vendor
- **THEN** the configured vendor is authoritative and core does not replace it with a built-in compiler

#### Scenario: Configured compile service is missing
- **WHEN** a planned component's effective environment does not define `services.compile`
- **THEN** compile identifies that component and missing service while continuing independent runnable work

### Requirement: One-shot compile dispatches the common vendor entry inline
When watch is false, compile SHALL resolve a compiler vendor module with valid metadata and a default `CompilerVendorStart`, invoke that entry through the generic inline vendor runner with one component, its opaque config, selected output paths, and the standard `VendorContext`, and validate its JSON-safe `CompileRunResult`. The vendor SHALL select one-shot behavior from the common watch flag rather than through a separate named module entry. A failed prerequisite SHALL block dependent components while independent dependency layers MAY finish.

#### Scenario: Compiler writes its artifact
- **WHEN** a one-shot compiler successfully produces its selected output
- **THEN** the default vendor entry returns a validated run result containing its optional produced output without echoing parent-owned component, environment, service, or path fields

#### Scenario: Vendor lacks the common entry
- **WHEN** a resolved compiler module has metadata but no valid default `CompilerVendorStart` function
- **THEN** dispatch fails before compilation with the canonical vendor module and selected service context

#### Scenario: Dependency compiler fails
- **WHEN** one component's one-shot compiler fails
- **THEN** its dependents are reported as blocked and an independent component remains eligible to compile

### Requirement: Compiler vendors own watch implementation and lifecycle
When watch is true, the compiler module's same default `CompilerVendorStart` entry SHALL select and own its initial compilation, filesystem or compiler-native watcher, incremental strategy, event coalescing, error recovery, and cleanup. Core compile orchestration SHALL NOT watch component files, re-invoke compilers on file events, or impose dependency invalidation after startup. Maintained TypeScript and environment compiler vendors SHALL each implement this lifecycle.

#### Scenario: TypeScript source changes
- **WHEN** the maintained TypeScript compiler is running in watch mode and one of its applicable inputs changes
- **THEN** that vendor performs its chosen incremental compilation and emits a new validated result without core observing the filesystem event

#### Scenario: Environment source changes
- **WHEN** the maintained environment compiler is running in watch mode and its source definition or support source changes
- **THEN** that vendor rebuilds its flattened environment artifact and emits a new validated result

#### Scenario: Watch compile encounters an error
- **WHEN** a watched compilation fails after a prior successful result
- **THEN** the vendor emits a task error, keeps its watcher alive, and can emit a later successful result after inputs are corrected

#### Scenario: Watch task stops
- **WHEN** the owner stops a compiler watch task
- **THEN** the vendor closes all watcher/compiler resources and emits no later results

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

### Requirement: Compile watch exposes caller-owned task contributions
The compile subsystem SHALL provide a watch contribution containing caller-owned vendor tasks, task bindings needed by supervision, and an idempotent disposal operation. Contribution creation SHALL NOT install process signal handlers, terminate the process, or create a managed terminal. It SHALL create and start tasks in prerequisite layers and SHALL wait for the initial successful artifact/readiness of a local environment prerequisite before resolving compiler services for dependent tasks.

#### Scenario: Caller prepares watch tasks
- **WHEN** a caller requests a compile watch contribution for selected components
- **THEN** it receives tasks it can supervise alongside other services without the contribution taking over terminal or process lifecycle

#### Scenario: Local environment artifact is initially absent
- **WHEN** a consumer selects a local environment whose watch compiler task has not yet produced `dist/index.json`
- **THEN** contribution preparation waits for that prerequisite's initial success before loading the environment and creating the consumer task

#### Scenario: Staged startup fails
- **WHEN** an environment compiler task fails before its required initial artifact becomes ready
- **THEN** contribution preparation stops already-created tasks and reports the failing prerequisite without leaking watchers

#### Scenario: Contribution is disposed twice
- **WHEN** a composed caller disposes the same contribution more than once
- **THEN** every task and binding is released exactly once without an additional failure

### Requirement: Standalone compile watch uses optional centralized supervision
The standalone `compile --watch` command SHALL supervise the prepared contribution once through the common vendor-task supervisor. It SHALL use one centralized managed terminal only when interactive terminal behavior is enabled and SHALL be able to supervise the same tasks non-interactively without a managed terminal. Signal handling and final shutdown SHALL belong to this standalone supervision layer, not to compiler vendors or the contribution factory.

#### Scenario: Interactive standalone watch starts
- **WHEN** `compile --watch` runs in an interactive terminal with managed display enabled
- **THEN** one centralized managed terminal presents all compiler tasks and coordinates shutdown

#### Scenario: Non-interactive standalone watch starts
- **WHEN** `compile --watch` runs with non-interactive supervision
- **THEN** compiler tasks remain active and report lifecycle output without constructing a managed terminal

#### Scenario: Future composed caller supervises compile
- **WHEN** another command obtains the compile contribution for composition with test or preview tasks
- **THEN** it can supervise and dispose those tasks under its own lifecycle without nested signal handlers or terminals

#### Scenario: Start command is invoked in this release
- **WHEN** the current `start` command runs
- **THEN** its behavior remains unchanged because compile-watch integration is outside this change

### Requirement: Install compilation remains one-shot
`install --compile` SHALL reuse the same configured compiler plan and one-shot dispatcher after dependency installation and linking. It SHALL NOT create watch tasks or pass watch mode to compiler vendors.

#### Scenario: Clean install requires a local environment
- **WHEN** `install --compile` prepares a workspace whose component selects a local environment
- **THEN** it one-shot compiles the environment through its configured compiler, loads the emitted artifact, and then compiles the consumer in dependency order

#### Scenario: Watch option is used with install
- **WHEN** install arguments include a vendor-specific or unsupported watch value
- **THEN** install does not enter the compiler watch lifecycle

## MODIFIED Requirements

### Requirement: Compile plans configured compiler services in dependency order
Compile SHALL resolve each included component's compiler from the `services.compile` definition of its effective environment without selecting a compiler from component kind. It SHALL include required local environment components in the plan, order planned components by local runtime and environment prerequisites, and invoke each component separately with its effective service config and selected-env identity.

Standalone compile selection SHALL continue to report an explicitly selected planned component whose compile service is missing. A composed caller SHALL be able to supply only compile-enabled selected roots so that absence of compile on another selected component is an expected omission. Once a root is included, every local env prerequisite added by the compiler dependency plan SHALL be mandatory: an unavailable prerequisite, a missing prerequisite compile service, or a failed prerequisite SHALL block its dependents and SHALL be reported with the prerequisite identity.

#### Scenario: Ordinary components cross environment boundaries
- **WHEN** an included component depends on another included local component whose effective environment configures a different compiler vendor
- **THEN** the dependency finishes its initial configured compile before the consumer is invoked with its own configured compiler

#### Scenario: Environment component is planned
- **WHEN** an included component requires a local environment component whose assigned environment configures the maintained environment compiler
- **THEN** compile invokes that configured vendor through the normal service dispatcher without a component-kind compiler branch

#### Scenario: Component kind and configured compiler disagree
- **WHEN** a `kind: "env"` component's effective environment configures a valid non-default compiler vendor
- **THEN** the configured vendor is authoritative and core does not replace it with a built-in compiler

#### Scenario: Standalone selected compile service is missing
- **WHEN** standalone compile plans a selected component whose effective environment does not define `services.compile`
- **THEN** compile identifies that component and missing service while continuing independent runnable work according to standalone failure semantics

#### Scenario: Start omits an optional root with no compile service
- **WHEN** start's resolved selection contains a component without `services.compile`
- **THEN** the composed compile plan omits that component as a root without treating its available preview or test service as failed

#### Scenario: Included local env prerequisite lacks compile
- **WHEN** a compile-enabled root requires a local env prerequisite whose effective environment does not define `services.compile`
- **THEN** compile reports that mandatory prerequisite, blocks its dependent compile task, and does not treat it as an optional selected-root skip

### Requirement: Compile watch exposes caller-owned task contributions
The compile subsystem SHALL provide a watch contribution containing caller-owned vendor tasks, task bindings needed by supervision and presentation, one cached readiness barrier for all contributed tasks, and one cached aggregate `dispose(): Promise<void>` operation. Contribution creation SHALL NOT install process signal handlers, terminate the process, or create a managed terminal. It SHALL create and start tasks in prerequisite layers and SHALL wait for the initial validated successful artifact/readiness of each prerequisite before resolving compiler services for dependent tasks.

The all-task readiness barrier SHALL cover final-layer and single-layer tasks as well as prerequisites, SHALL single-flight repeated observations, and SHALL resolve only after every included task has produced its first validated successful result. An initial preparation or readiness failure SHALL reject the barrier and cleanup SHALL stop already-created tasks without leaking watchers. The contribution's disposer SHALL remain the complete owner of its tasks and bindings and every repeated call SHALL return the same completion promise.

#### Scenario: Caller prepares watch tasks
- **WHEN** a caller requests a compile watch contribution for included components
- **THEN** it receives tasks, bindings, an all-task readiness barrier, and aggregate disposal without the contribution taking over terminal or process lifecycle

#### Scenario: Local environment artifact is initially absent
- **WHEN** a consumer includes a local environment whose watch compiler task has not yet produced `dist/index.json`
- **THEN** contribution preparation waits for that prerequisite's initial success before loading the environment and creating the consumer task

#### Scenario: Single-layer compile starts slowly
- **WHEN** the compile contribution contains only one dependency layer
- **THEN** the all-task barrier remains pending until every task in that layer emits its first validated successful result

#### Scenario: Final-layer compile fails initially
- **WHEN** prerequisites are ready but a final-layer compile task fails before its first successful result
- **THEN** the all-task readiness barrier rejects and does not report the contribution as safe for preview or test startup

#### Scenario: Staged startup fails
- **WHEN** an environment compiler task fails before its required initial artifact becomes ready
- **THEN** contribution cleanup stops already-created tasks and reports the failing prerequisite without leaking watchers

#### Scenario: Runtime rebuild fails after readiness
- **WHEN** every included task has crossed the initial readiness barrier and a later rebuild fails
- **THEN** the task exposes its structured error state, keeps its watcher alive, and remains able to report a later successful rebuild

#### Scenario: Contribution is disposed repeatedly
- **WHEN** a composed caller disposes the same contribution concurrently or more than once
- **THEN** every caller receives the same completion promise and every task and binding is released exactly once

### Requirement: Standalone compile watch uses optional centralized supervision
The standalone `compile --watch` workflow SHALL supervise the prepared compile contribution once through the common vendor-task supervisor. The top-level `watch` command SHALL call this same workflow with effective watch mode forced on and SHALL NOT duplicate its runner. Standalone compile watch SHALL use one centralized managed terminal only when interactive terminal behavior is enabled and SHALL supervise the same tasks non-interactively without a managed terminal. Signal handling and final shutdown SHALL belong to the standalone supervision layer, not to compiler vendors or the contribution factory.

When start composes compile with preview and test, start SHALL consume the contribution directly and SHALL own the only root signal/terminal supervisor. Neither standalone wrapper SHALL be invoked from start. Standalone and composed supervisors SHALL delegate compile task cleanup to the contribution's cached aggregate disposer and MUST NOT stop the same task list separately.

#### Scenario: Interactive standalone watch starts
- **WHEN** `compile --watch` or `watch` runs in an interactive terminal with managed display enabled
- **THEN** one centralized managed terminal presents all compiler tasks and coordinates root shutdown

#### Scenario: Non-interactive standalone watch starts
- **WHEN** `compile --watch` or `watch` runs with non-interactive streams
- **THEN** compiler tasks remain active and report lifecycle output without constructing a managed terminal

#### Scenario: Start supervises compile
- **WHEN** start obtains the compile contribution for composition with preview or test tasks
- **THEN** start supervises and disposes those tasks under its own lifecycle without nested signal handlers, terminals, standalone command wrappers, or duplicate task stopping

#### Scenario: Standalone shutdown begins
- **WHEN** a standalone compile-watch session receives a supported termination signal
- **THEN** its root supervisor invokes the compile contribution's aggregate disposer exactly once

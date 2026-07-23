## ADDED Requirements

### Requirement: Vendor command orchestration accepts open service identifiers
The command-side vendor execution API SHALL accept a non-empty service identifier as an opaque string and SHALL NOT encode the currently supported env services as a closed union in the orchestration contract. Env schema validation MAY independently restrict which services can be declared. An env-service plan SHALL derive units from the already resolved command selection and SHALL silently omit an env group that does not expose the requested resolved service without creating unavailable-service state.

#### Scenario: Existing service is planned
- **WHEN** a caller plans the string service identifier `test` for a resolved selection whose env groups expose that service
- **THEN** the plan contains one execution unit for each configured env group with its resolved service and selected canonical components

#### Scenario: Arbitrary service identifier is requested
- **WHEN** a caller supplies a non-empty service identifier that is not named in the command orchestration implementation
- **THEN** the API accepts the string without requiring a framework union change and includes any group whose resolved service map recognizes it

#### Scenario: Selected env omits the service
- **WHEN** a selected env group does not expose the requested resolved service
- **THEN** that group contributes no execution unit and no unavailable-service record

### Requirement: Every vendor execution uses a validated layered plan
A vendor execution plan SHALL contain one or more ordered layers of uniquely identified units, and every unit SHALL declare the IDs of units it depends on. A dependency MUST identify a unit in an earlier layer. The same plan representation SHALL support single-layer commands and dependency-ordered commands. Plan validation SHALL reject duplicate IDs, missing dependencies, and same-layer or later-layer dependencies before vendor preparation begins.

#### Scenario: Test or preview plan is created
- **WHEN** configured env-service units have no ordering dependencies
- **THEN** the planner places all units in one layer with empty dependency lists

#### Scenario: Compile plan is created
- **WHEN** selected components include local component or environment prerequisites
- **THEN** the planner places prerequisites in earlier layers and records their unit IDs as dependencies of consumers

#### Scenario: Plan has an invalid dependency
- **WHEN** a unit references a missing unit or a unit in the same or a later layer
- **THEN** validation fails before any vendor URL is resolved or task is created

### Requirement: Vendor execution definitions share preparation across modes
A vendor execution definition SHALL contain an opaque string service identifier, a label, one unit preparation contract, and optional run and watch contracts. Preparation SHALL receive the planned unit, immutable effective command arguments, execution mode, and command-specific context, and SHALL produce standard vendor task options plus optional command-owned prepared metadata. Run and watch execution SHALL use the same preparation contract and SHALL force their effective watch argument without mutating the parsed selection or its arguments.

#### Scenario: Test supports run and watch
- **WHEN** test executes the same env-service unit once and later creates its watch contribution
- **THEN** both modes use the same vendor resolution, context construction, selected components, and effective service config while receiving different immutable watch values

#### Scenario: Preview supports only watch
- **WHEN** preview defines no run contract
- **THEN** it can still use the shared plan and preparation API to create watch tasks without exposing an unsupported run entry

#### Scenario: Parsed arguments are reused by composed callers
- **WHEN** a watch contribution forces watch mode for a selection shared with another command
- **THEN** it creates effective arguments without mutating or discarding the original raw, option, or passthrough values

### Requirement: Run execution preserves layers and dependency isolation
The generic run executor SHALL process plan layers in order, SHALL run eligible units within one layer concurrently, and SHALL validate every vendor result before recording success. A failed unit SHALL block only units that directly or transitively depend on it. Independent units in the current or later layers SHALL remain eligible. The executor SHALL expose per-unit successful, failed, and blocked outcomes so command-specific presentation can retain its existing result and error format.

#### Scenario: Single-layer test run executes
- **WHEN** test has several configured env units in one layer
- **THEN** their vendor tasks are eligible together and each successful result is validated before test presentation

#### Scenario: Compile prerequisite fails
- **WHEN** one compile unit fails and a later unit depends on it
- **THEN** the dependent unit is recorded as blocked without vendor invocation while an unrelated later-layer unit remains eligible

#### Scenario: Vendor returns an invalid run result
- **WHEN** a run vendor returns data rejected by the command's run validator
- **THEN** that unit is recorded as failed and its dependents follow the same blocking rule as an execution failure

### Requirement: Watch tasks expose validated result observation
A worker-backed watch task SHALL expose a promise for its first validated event result and a subscription mechanism for subsequent validated event results. The first-result promise SHALL be established before eager or deferred activation, SHALL resolve at most once, and SHALL reject if the task fails or stops before producing a valid result. Invalid event data MUST NOT be published through either validated-result API.

#### Scenario: Eager task produces an initial result
- **WHEN** an eagerly activated watch vendor emits a valid result during startup
- **THEN** the task's first-result promise resolves with that validated result without requiring a command-installed raw message listener

#### Scenario: Deferred task activates
- **WHEN** a preview contribution activates an idle task and the vendor emits its first valid server result
- **THEN** the same stable task resolves its first-result promise and later valid results remain observable through its result subscription

#### Scenario: Task fails before its first result
- **WHEN** an initial compiler or preview startup failure occurs before a valid result
- **THEN** the first-result promise rejects and does not later resolve

#### Scenario: Vendor emits an invalid event result
- **WHEN** the watch result validator rejects emitted data
- **THEN** the task reports a validation failure and neither the first-result promise nor validated-result subscribers receive that data

### Requirement: Watch execution supports activation and layered startup
The generic watch executor SHALL create stable worker-backed tasks from planned units with explicit eager or deferred activation. A single-layer plan SHALL return after its stable tasks are created and SHALL isolate unit preparation failures while successfully prepared units continue. A multi-layer plan SHALL use eager activation, SHALL advance only after every task created for the current layer produces its first validated result, and SHALL abort on a preparation failure because later layers may depend on the failed unit. A layered startup failure SHALL release already-created work through the contribution's aggregate lifecycle boundary. The executor SHALL NOT install process signals, create a managed terminal, or supervise a resident session.

For a successfully prepared unit, the executor SHALL expose a single-flight readiness operation that activates its stable task when needed and waits for its first validated result. Concurrent and later readiness requests for the same unit SHALL share the cached success or failure. Readiness requested after execution disposal, or still pending when disposal begins, SHALL reject without publishing a late successful result. A unit that fails before becoming ready SHALL be stopped through its idempotent task stop operation.

#### Scenario: Test watch plan starts
- **WHEN** test creates an eager one-layer watch plan
- **THEN** the executor returns its stable started tasks without installing root supervision

#### Scenario: Lazy preview plan is created
- **WHEN** preview requests deferred activation for its one-layer plan
- **THEN** the executor returns stable idle tasks that the preview contribution can activate later

#### Scenario: Compile watch advances a layer
- **WHEN** every eager compile task in one layer produces its first valid result
- **THEN** the executor prepares and creates the next dependency layer without requiring command-specific barrier configuration

#### Scenario: Compile prerequisite fails during startup
- **WHEN** a compile task fails before producing the first result required to advance
- **THEN** later layers are not constructed and already-created work is handed to aggregate contribution cleanup

#### Scenario: Single-layer unit preparation fails
- **WHEN** one unit in a single-layer test or preview plan cannot be prepared
- **THEN** the executor records its preparation failure and continues with successfully prepared units

#### Scenario: Layered unit preparation fails
- **WHEN** one unit in a multi-layer compile plan cannot be prepared
- **THEN** the executor aborts layered startup and releases already-created work

#### Scenario: Concurrent lazy readiness is requested
- **WHEN** multiple preview requests ask the same deferred unit to become ready
- **THEN** one activation waits for the first validated result and every requester observes the same cached readiness outcome

#### Scenario: Lazy readiness fails
- **WHEN** a deferred unit fails before its first validated result
- **THEN** its task is stopped and later readiness requests receive the cached failure without another activation

#### Scenario: Disposal races with lazy readiness
- **WHEN** execution disposal begins before or during deferred unit activation
- **THEN** readiness rejects and no late successful result is returned after disposal

### Requirement: Commands extend reusable watch contributions with domain state
The watch executor SHALL provide the plan, prepared units, stable tasks, and validated-result observation to a command-specific contribution builder. Compile, test, and preview SHALL retain non-blocking contribution entry points that can add their required bindings, routes, stores, state, manifests, activation behavior, and preparation failures. Contribution factories SHALL remain separate from standalone root supervision and SHALL follow the aggregate ownership contract defined by the watch-session lifecycle.

#### Scenario: Test contribution is reused
- **WHEN** a composed caller requests a test watch contribution from an existing resolved selection
- **THEN** it receives test tasks, component bindings, result read behavior, routes, and one aggregate disposer without a terminal or signal owner

#### Scenario: Preview contribution is reused
- **WHEN** a composed caller supplies proxy context and requests preview watch work
- **THEN** it receives stable preview tasks, state, routes, manifest projection, activation behavior, and preparation failures without opening another public proxy or root supervisor

#### Scenario: Compile contribution is reused
- **WHEN** a caller requests compile watch work for a layered compile plan
- **THEN** it receives the staged tasks, component bindings, plan, and aggregate disposer after the initial results required between layers are satisfied

### Requirement: Compile, test, and preview retain command-specific behavior
Refactoring through vendor command execution SHALL preserve compile dependency ordering and output reporting, test run/watch result validation and presentation, and preview preparation isolation, routes, state, server projection, and eager or lazy activation. Start, install, and link SHALL remain outside this vendor execution abstraction. The refactor SHALL NOT change vendor message payloads, env service definitions, CLI result formats, or public preview routes and manifests.

#### Scenario: Compile runs after migration
- **WHEN** compile executes in run or watch mode through the generic execution API
- **THEN** it retains its component-level planning, dependency semantics, configured compiler selection, results, and watch contribution behavior

#### Scenario: Test runs after migration
- **WHEN** test executes once or creates a watch contribution through the generic execution API
- **THEN** it retains one task per configured env, existing validation, output, bindings, and result routes

#### Scenario: Preview runs after migration
- **WHEN** preview creates its contribution through the generic execution API
- **THEN** it retains one logical task per successfully prepared configured env, independent preparation failures, stable routes/state, and current eager or lazy behavior

#### Scenario: Non-vendor command runs
- **WHEN** start, install, or link executes
- **THEN** this capability imposes no generic vendor execution plan or definition on that command

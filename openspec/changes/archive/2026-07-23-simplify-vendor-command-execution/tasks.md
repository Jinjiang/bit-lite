## 1. Layered Execution Planning

- [x] 1.1 Add command-side `PlannedUnit` and `VendorExecutionPlan` types
- [x] 1.2 Validate unique unit IDs, dependency existence, and earlier-layer dependency ordering before preparation
- [x] 1.3 Add a string-keyed resolved-service accessor and stable single-layer env-service planner that reuses selection groups and silently skips missing services
- [x] 1.4 Cover open service strings, single-layer plans, compile-shaped layers, empty plans, and invalid plan rejection

## 2. Validated Watch Results

- [x] 2.1 Add a watch-task result type exposing the first validated event result and validated result subscriptions
- [x] 2.2 Resolve or reject first-result observation across eager/deferred activation, invalid results, task failure, and stop-before-result
- [x] 2.3 Migrate internal event-result publication so command subscribers never receive unvalidated payloads
- [x] 2.4 Add vendor-task tests for first result, repeated results, late subscriptions, invalid results, and activation/failure races

## 3. Vendor Execution Kernel

- [x] 3.1 Add the open-string vendor execution definition and shared unit preparation contract with immutable run/watch arguments
- [x] 3.2 Add shared resolved-service task-option preparation for vendor URL, vendor context, components, config, and optional runtime
- [x] 3.3 Implement layered run execution with concurrent eligible units, validated outcomes, dependency blocking, and independent continuation
- [x] 3.4 Implement watch task creation with plan-derived activation sequencing and preparation-failure handling plus base contribution inputs
- [x] 3.5 Add kernel tests for one-layer and multi-layer execution, result validation, failure isolation, activation modes, layer sequencing, and startup rollback
- [x] 3.6 Add single-flight unit readiness with cached outcomes, failed-unit stopping, and disposal-race coverage

## 4. Test Command Migration

- [x] 4.1 Define test vendor execution once and create its single-layer plan from configured resolved env groups
- [x] 4.2 Route one-shot test execution through the generic run executor without changing result validation or printed output
- [x] 4.3 Route test watch contribution creation through the generic watch executor while retaining bindings, validated result storage, and routes
- [x] 4.4 Update test command, contribution, composition, and argument-immutability tests

## 5. Compile Command Migration

- [x] 5.1 Project the compile component/prerequisite graph into layered planned units with explicit dependency IDs
- [x] 5.2 Route one-shot compilation through dependency-aware run execution while retaining successful, failed, and blocked reporting
- [x] 5.3 Route compile watch contribution startup through eager layered execution with automatic first-result sequencing
- [x] 5.4 Remove compile-local first-result promises and duplicated layer/task loops after equivalent behavior is covered
- [x] 5.5 Update compile run/watch tests for ordering, independent continuation, dependent blocking, prerequisite startup, contribution reuse, and invalid results

## 6. Preview Command Migration

- [x] 6.1 Define preview's one-layer watch execution with isolated command-owned preparation and deferred stable tasks
- [x] 6.2 Replace preview's raw result-by-env map with validated first-result observation during eager or lazy activation
- [x] 6.3 Build the preview contribution from generic plan/task inputs while retaining state, routes, manifest, port hints, bindings, and preparation failures
- [x] 6.4 Update preview unit and end-to-end tests for partial preparation, eager/lazy activation, actual server projection, invalid results, and composition

## 7. Integration and Verification

- [x] 7.1 Remove superseded command-local service resolution, argument normalization, task maps, promises, and execution loops
- [x] 7.2 Reconcile command wrappers with `simplify-watch-shutdown-lifecycle` so aggregate contribution disposal remains the only contributed-resource cleanup boundary
- [x] 7.3 Document the layered plan, open service ID, preparation, run/watch, and contribution extension APIs
- [x] 7.4 Run focused package tests, command integration and end-to-end tests, workspace type checks/builds, and OpenSpec validation with pnpm

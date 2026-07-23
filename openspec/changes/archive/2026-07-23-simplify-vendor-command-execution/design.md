## Context

Compile, test, and preview are all parent-side commands that resolve an environment service, prepare vendor task input, and execute it through the generic vendor task layer. Their entry points nevertheless repeat different portions of the same mechanics:

- test maps resolved env groups to task options separately for run and watch;
- preview maps env groups through command-owned preparation, creates deferred tasks, and maintains task/result lookup maps for activation;
- compile prepares one component at a time, implements dependency-layer scheduling for run, and recreates a first-result promise for staged watch startup.

The important differences are real: test and preview execute once per selected env, compile executes once per component in dependency order, preview isolates preparation failures and may defer activation, and compile blocks dependent run work or aborts watch startup when a prerequisite cannot produce its initial artifact. The abstraction must expose those decisions rather than replace them with one fixed pipeline.

The separate `simplify-watch-shutdown-lifecycle` change defines aggregate contribution ownership, root signal supervision, and the single task stop operation. This design assumes that lifecycle contract and does not create a competing disposal or supervision model.

## Goals / Non-Goals

**Goals:**

- Make compile, test, and preview entry points read as selection, plan creation, empty-plan handling, run/watch execution, and presentation.
- Use one layered execution-plan representation for single-layer and dependency-ordered commands.
- Keep service identifiers opaque and open to arbitrary strings at the orchestration API boundary.
- Reuse one preparation contract for vendor resolution, context construction, config/runtime projection, and task option construction.
- Preserve compile's dependency-aware run behavior and initial-result watch sequencing.
- Preserve preview's command-owned preparation, independent preparation failures, state/routes, and eager or lazy activation.
- Preserve non-blocking contribution entry points for composed callers.

**Non-Goals:**

- Adding new service names to the env schema or changing how env definitions validate supported services.
- Tracking or presenting unavailable env-service groups.
- Refactoring start, install, or link through the vendor execution abstraction.
- Redesigning signals, managed-terminal ownership, contribution disposal, or task stopping.
- Changing vendor message shapes, result payloads, CLI output formats, routes, or public manifests.
- Hiding command-specific planning, preparation, result projection, or presentation behind an all-purpose command DSL.

## Decisions

### 1. Keep the abstraction command-side

The new planning and execution utilities live in `bit-lite` command utilities rather than `bit-lite-vendors`. They depend on resolved command selection, env contexts, workspace components, command arguments, and service resolution, all of which are parent-side concepts. `bit-lite-vendors` remains the service-agnostic runner/task layer.

Only the validated first-result observation primitive belongs in `bit-lite-vendors`, because it is a property of every worker-backed watch task and removes command-owned result races.

Alternative considered: teach `bit-lite-vendors` how to group envs and prepare resolved services. This was rejected because it reverses the existing dependency boundary and makes the generic execution package depend on workspace/env resolution.

### 2. Represent every execution as a layered plan

The common plan shape is conceptually:

```ts
type PlannedUnit<Unit> = {
  id: string;
  dependsOn: readonly string[];
  value: Unit;
};

type VendorExecutionPlan<Unit> = {
  layers: readonly (readonly PlannedUnit<Unit>[])[];
};
```

Unit IDs are unique. Dependencies identify other units in the same plan and must be placed in an earlier layer. The plan validator rejects duplicate IDs, missing dependencies, dependencies in the same or a later layer, and repeated unit references.

Test and preview create a single-layer plan from the env groups already present in `ResolvedCommandSelection`. Compile creates a component unit for every requested component and local env prerequisite, records its local component/env prerequisite IDs, and retains its current topological layers.

Keeping `dependsOn` in addition to layers is necessary for run failure behavior: after one component fails, only its transitive dependents are blocked while unrelated units in later layers may still run.

Alternative considered: model ordered commands and flat commands with separate APIs. This was rejected because one layer naturally represents an unordered execution and would duplicate preparation, validation, and task construction.

### 3. Resolve env-service units through an open string identifier

The env-service planner accepts `serviceId: string` (or a generic literal type extending `string`) and obtains the resolved service through a string-keyed accessor. The orchestration API does not contain a `"test" | "preview" | "compile"` union. Current env schema validation may remain closed independently.

The planner consumes the selection's already derived env groups and returns only units whose env exposes the requested resolved service. Groups without that service are omitted silently; the plan carries no unavailable collection or missing-service reason.

Alternative considered: put `serviceId` in a closed union for exhaustive typing. This was rejected because it couples reusable orchestration to today's services and requires framework edits for every future service.

### 4. Define preparation once per vendor execution

A vendor execution definition contains:

- an opaque service ID and display label;
- a unit preparation function;
- an optional run contract;
- an optional watch contract.

Preparation receives the planned unit, effective immutable command arguments, mode, and command-specific context. It returns `VendorTaskStartOptions` plus optional command-owned prepared metadata. Shared helpers resolve the vendor URL, construct the standard vendor context, and project components, config, and optional runtime without interpreting service-specific prepared data.

The engine clones arguments and forces the appropriate watch value for each mode without mutating the parsed selection. Test uses default env-service preparation, compile adds its dist/runtime projection, and preview supplies its generated config/runtime and prepared metadata.

Alternative considered: let run and watch define separate preparation functions. This was rejected because it recreates the current duplication and risks divergent service config or context.

### 5. Execute run plans with dependency-aware outcomes

The run executor processes layers sequentially and eligible units within each layer concurrently. It validates every returned result through the definition's run contract and records a per-unit success, failure, or blocked outcome.

Before a unit runs, the executor checks its declared dependencies. A failed or blocked dependency blocks that unit without invoking its vendor. Failures do not stop unrelated units in the current or later layers. At completion, the command definition can project successful results and aggregate failures using its existing presentation semantics.

For test's one-layer plan, every configured env task is eligible immediately. Compile uses the same executor with multiple layers and retains its current independent-work and dependent-blocking behavior.

Alternative considered: abort the entire plan on the first failure. This was rejected because compile explicitly preserves independent runnable work.

### 6. Watch tasks expose their first validated result

`createWatchVendorTasks` returns a watch-task type that exposes:

- one promise for the first validated event result; and
- a subscription for later validated results when a command needs a store or read model.

The first-result promise is established before eager or deferred activation, resolves once, and rejects when the task fails or stops before producing a valid result. Validation occurs before the result becomes observable through these APIs.

This replaces compile's local first-result resolver and preview's result-by-env map. Preview can activate a stable task and await its first result to project the actual server; test can subscribe to validated results for its test read model.

Alternative considered: keep using raw `VendorMessage` listeners in each command. This was rejected because it exposes unvalidated payloads and recreates buffering/race handling around activation.

### 7. Derive watch sequencing from plan shape

The watch executor creates stable tasks from prepared units and supports eager or deferred activation. A single-layer plan returns after its stable tasks are created and isolates preparation failures so its independent units can continue. A multi-layer plan requires eager activation, aborts if a unit cannot be prepared, and automatically waits for every current-layer task's first validated result before preparing the next layer.

Compile uses the fixed multi-layer sequencing so local env artifacts exist before dependent services are resolved. A layered preparation or task failure aborts contribution construction and delegates rollback to the aggregate contribution disposer. Test uses eager activation in one layer. Preview creates one layer of deferred tasks and lets its contribution apply eager or lazy command-specific activation while updating preview state.

The executor exposes `ensureUnitReady(unitId)` as the mechanical activation boundary. It single-flights task activation plus first-result observation, caches success or failure, stops a unit that fails before readiness, and rejects disposal races. Preview retains env-to-unit mapping, proxy state transitions, server projection, and route-trigger policy.

The engine does not install signals or a terminal and does not supervise the resident session.

Alternative considered: make the executor always activate every watch task immediately. This was rejected because lazy preview requires a stable idle task that can be composed and supervised before worker creation.

### 8. Let definitions extend a base contribution

The watch executor supplies the execution definition with the plan, prepared units, stable tasks, and validated-result observation APIs. A command-specific contribution builder adds only its domain projections:

- compile adds its plan and component/task bindings;
- test adds task/component bindings and test result routes/read model;
- preview adds preview state, routes, manifest projection, activation controller, and preparation failures.

The returned contribution follows the aggregate ownership contract from `simplify-watch-shutdown-lifecycle`. Root command wrappers pass its tasks and disposer into root supervision; this change does not alter the supervisor or task stop implementation.

Alternative considered: force every contribution to expose only tasks. This was rejected because composed callers legitimately consume test routes and preview state/routes, while those concepts do not belong in the generic execution layer.

### 9. Keep entry-point policy visible

Command entry points retain:

1. selection resolution;
2. command-specific plan creation;
3. empty-plan reporting;
4. the run/watch choice when both are supported;
5. external preparation such as the standalone preview proxy;
6. command result or endpoint presentation; and
7. root supervision.

The abstraction removes mechanical loops but does not generate entire command modules. Preview-only watch behavior remains explicit, as do compile's custom plan and test's result presentation.

## Risks / Trade-offs

- [A generic definition becomes a callback-heavy command DSL] → Limit it to plan execution, task preparation, result validation, and base contribution construction; keep selection and presentation in each command.
- [Layer validation rejects a previously tolerated compile plan] → Build plans from canonical unit IDs and add focused validation tests before migrating compile.
- [First-result observation changes result timing] → Establish the promise before activation and test eager, deferred, failure-before-result, and repeated-result cases.
- [A deferred readiness result outlives its contribution] → Check execution disposal before and after activation and first-result observation, and reject rather than publish a late success.
- [Preview preparation and activation remain complex] → Keep preview state/routes in preview-specific code and extract only the common task mechanics.
- [Concurrent work overlaps the shutdown lifecycle refactor] → Depend on the aggregate contribution contract, avoid edits to signal/terminal policy, and rebase or adapt once `simplify-watch-shutdown-lifecycle` lands.
- [Open string service lookup weakens exhaustiveness] → Keep env schema validation independent and return no plan unit when the resolved selection lacks the requested service.

## Migration Plan

1. Add the layered plan types and validation plus an open-string env-service planner that returns stable single-layer plans.
2. Add validated first-result and result-subscription primitives to watch tasks without changing vendor message payloads.
3. Add the shared preparation helpers and generic run/watch execution definitions.
4. Migrate test first as the one-layer run/watch reference and retain its existing output and contribution routes.
5. Migrate compile to the layered run executor and automatic first-result watch sequencing, verifying independent failures and prerequisite startup.
6. Migrate preview preparation and activation onto the one-layer watch executor while retaining isolation, routes, state, and lazy behavior.
7. Remove superseded command-local task maps, result promises, argument normalizers, and duplicated loops.
8. Reconcile the final wrappers with `simplify-watch-shutdown-lifecycle`, then run focused and workspace verification.

Rollback restores the command-local orchestration while leaving the generic vendor task lifecycle intact. There is no persisted-data or workspace-config migration.

## Open Questions

- Whether the implementation names the façade `defineVendorExecution`, `createVendorExecution`, or uses direct `runVendorPlan`/`createVendorWatchContribution` functions can be decided during implementation; the capability contract is the plan and execution behavior, not one exact factory name.

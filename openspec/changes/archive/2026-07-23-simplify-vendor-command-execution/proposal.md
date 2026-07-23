## Why

The compile, test, and preview commands repeat the same selection-to-task plumbing while expressing their real differences through ad hoc loops, result maps, activation promises, and run/watch branches. A command-side vendor execution abstraction can make those commands read as selection, planning, preparation, and execution without hiding compile ordering or preview preparation.

## What Changes

- Introduce a reusable command-side vendor execution definition with an opaque string `serviceId`, service label, unit preparation hook, and optional run/watch contracts.
- Represent every vendor-backed command execution as a layered plan: test and preview use one layer, while compile retains dependency-ordered layers and per-unit dependency identities.
- Add a generic env-service planner that consumes the already resolved command selection, silently omits env groups without the requested service, and does not maintain unavailable-service reporting.
- Add a run-plan executor that runs each layer in order, runs eligible units within a layer concurrently, validates results, records failures, blocks only dependent units, and preserves independent work.
- Add a watch-plan executor that creates stable tasks from the same prepared units, supports eager or deferred activation for single-layer plans, exposes single-flight unit readiness, and waits for first validated results before advancing a multi-layer plan.
- Keep non-blocking watch contribution entry points for compile, test, and preview so composed callers can reuse their tasks and command-specific routes, state, stores, or bindings.
- Refactor compile, test, and preview command entry points to expose their business flow while moving repeated vendor resolution, context construction, task creation, mode argument normalization, and layered execution mechanics behind the new API.
- Exclude start, install, and link because they are not individual vendor-service command executions.
- Do not redesign shutdown, task stop, or contribution disposal; this change consumes the aggregate ownership contract defined by `simplify-watch-shutdown-lifecycle`.

## Capabilities

### New Capabilities

- `vendor-command-execution`: Defines open service identifiers, layered vendor execution plans, reusable preparation and run/watch execution contracts, and command-facing contribution construction for vendor-backed commands.

### Modified Capabilities

None.

## Impact

- Affects command orchestration utilities and the compile, test, and preview command modules.
- Affects generic vendor watch-task result observation because compile layer sequencing and preview activation need a first validated result primitive.
- Consolidates existing task preparation and execution behavior without changing env schema support, vendor message shapes, command result formats, preview routing behavior, compile dependency semantics, or test semantics.
- Coordinates with the separate shutdown lifecycle change and assumes contributions ultimately own all tasks and auxiliary resources they create.

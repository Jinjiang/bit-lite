## Context

The current compiler path treats compilation as a mixture of command orchestration and component-kind-specific behavior. It exposes an unused positional-argument surface, compiles environment components through a fixed materializer, and has no reusable watch lifecycle. This differs from test and preview, whose long-running work can be represented as vendor tasks and then supervised by either a standalone command or a larger composition such as `start`.

Environment components should not be a special routing case. They receive an environment just like every other component, and that environment configures a compiler service. The maintained environment compiler is an ordinary compiler vendor in `demo-vendors`; its distinctive behavior is the artifact it produces: a flattened, versioned `dist/index.json` with enough provenance to load service vendors relative to their declaring packages.

Watch mode crosses the CLI, compiler contracts, task supervision, and maintained vendors. The core command can coordinate compiler tasks, but it must not own filesystem watching because the correct incremental strategy and recovery behavior are compiler-specific.

## Goals / Non-Goals

**Goals:**

- Route every component through the compiler service configured by its effective environment, without checking component kind.
- Make `--watch` a common compiler-vendor input while keeping filesystem watching, incremental compilation, error recovery, and watcher cleanup inside each vendor.
- Expose compile watch work as caller-owned vendor tasks that can run with or without a centralized managed terminal.
- Let the standalone compile command supervise those tasks while preserving a clean boundary for a future `start` integration.
- Remove the unsupported positional-argument contract and keep vendor context on its existing version while replacing the pre-release shape directly.
- Compile environment definitions into a flattened, versioned JSON artifact and load that artifact through the normal environment/package pipeline.

**Non-Goals:**

- Integrating compiler watch tasks into `start` in this change.
- Adding a core filesystem watcher, core incremental compiler, or component-kind-specific compiler selection.
- Requiring an interactive managed terminal for every watch consumer.
- Providing compatibility adapters for the old positional or vendor-context shapes; the project is pre-release.
- Making `install --compile` long-running; install remains a one-shot workflow.

## Decisions

### 1. Compiler selection always comes from the effective environment

The compiler planner first resolves the selected components and any local environment components needed to make their effective environments loadable. For every planned component, it loads that effective environment and resolves `services.compile` through the existing service-vendor mechanism. No branch inspects `component.kind` to select a compiler.

Environment components are bootstrapped by assigning them an environment whose `services.compile` points to the maintained environment compiler vendor. That vendor lives in `demo-vendors` and participates in the same dispatch contract as the TypeScript compiler.

Alternative considered: select a built-in compiler whenever `component.kind === "env"`. This was rejected because it creates a second compiler-routing system and prevents environment configuration from being the single source of truth.

### 2. One-shot compilation and watch execution share one default vendor entry

A compiler vendor module has the same public shape as other vendor modules: valid `meta` plus one required `default: CompilerVendorStart` function. Core always invokes that default entry through the generic vendor runner. The vendor reads the common `context.args.options.watch` flag and decides internally whether to compile once or start its long-running watch implementation. A one-shot run returns a validated `CompileRunResult`; a watch run performs an initial compile, owns its watcher or compiler-native watch program, emits task status/results/errors, and returns cleanup that closes all resources. Compiler modules do not expose a second named lifecycle entry.

The compile-specific input, output, module, and validation contracts live in a
service-domain package, `bit-lite-compiler`. Both core orchestration and compiler
implementations depend on that package. `bit-lite-vendors` remains limited to
service-agnostic vendor context, runner, message, and task primitives and does
not export compiler-specific definitions.

The common contract describes the lifecycle, not the watching mechanism. Maintained TypeScript and environment compiler vendors each branch on the common watch flag inside their default entry and explicitly implement watch mode, optionally sharing internal helper code in `demo-vendors`. A third-party compiler can use its compiler's native incremental API instead.

Alternative considered: put a `chokidar` watcher in `bit-lite` and repeatedly invoke every compiler. This was rejected because it imposes incorrect invalidation, debouncing, and recovery semantics on all compiler implementations and makes the command responsible for vendor internals.

### 3. Compile watch mode is a composable task contribution

The compiler package exposes a contribution factory that prepares caller-owned watch tasks and any bindings required to coordinate them. The factory does not install process signal handlers, create a managed terminal, or decide how the surrounding process exits. It starts prerequisite layers in dependency order so that a local environment compiler can emit its initial artifact before a consumer's compiler service is resolved.

The standalone `compile --watch` command consumes the contribution and calls centralized task supervision once. It enables the managed terminal when interactive output is appropriate and can supervise the same tasks non-interactively without one. Disposing the contribution stops every vendor task and releases bindings.

This mirrors the separation used by test and preview and gives a future `start` task a stable integration point. `start` itself is unchanged in this proposal.

Alternative considered: let the compile command own watchers and its own terminal loop. This was rejected because the resulting lifecycle cannot be composed safely and duplicates existing supervision behavior.

### 4. The core plans dependency order but does not implement watch invalidation

For one-shot compilation, components execute in dependency layers and a failed prerequisite blocks downstream components. For watch mode, the same ordering governs initial task creation/readiness. After startup, each compiler vendor owns what inputs it watches and how it reacts to changes; the core does not re-run vendors, synthesize dependency invalidation, or rebuild the graph on filesystem events.

This keeps the architecture generic. A vendor that needs dependency-aware behavior may watch dependency outputs or use a compiler-native project graph.

### 5. Vendor context remains version 1 and drops positional arguments in place

The vendor context continues to use its existing version discriminator. Its CLI argument payload contains named options, raw argv, and passthrough arguments only. Bare CLI arguments after the command are rejected with guidance to use `--filter` or `--` as appropriate.

Alternative considered: introduce `VendorContextV2` while retaining the old shape. This was rejected because there are no deployed compatibility consumers and doing so would create premature legacy code.

### 6. Environment compiler output is a flattened, provenance-aware artifact

Source environment definitions may use `extends`. The environment compiler resolves the inheritance chain, merges services/configuration deterministically, and writes `dist/index.json` with a format version, final environment identity, flattened services/configuration, the inheritance path, and per-service origin information. Runtime loading reads this artifact directly rather than re-evaluating `extends`.

Origin metadata records the dependency path from the consuming environment package to the package that declared each service vendor. The loader follows that path package by package before resolving the vendor entry. This preserves correct package-relative resolution after flattening.

Alternative considered: copy the source definition into `dist` and resolve inheritance at runtime. This was rejected because generated environments should be self-contained, deterministic compiler artifacts and should not require source files to remain present.

### 7. Install compilation reuses the one-shot pipeline

`install --compile` invokes the same planner and compiler dispatch as `compile` without watch mode. Workspace preparation uses that pipeline for environment artifacts rather than calling a fixed environment materializer. This avoids two implementations with different service selection and failure behavior.

## Risks / Trade-offs

- [Compiler vendors may implement watch behavior inconsistently] → Define lifecycle and task-event conformance tests, and provide two maintained reference implementations.
- [A dependent watch vendor may not react when a dependency changes] → Keep invalidation explicitly vendor-owned and document that vendors may watch dependency outputs or use native project references.
- [A consumer compiler service cannot be resolved until its local environment is initially compiled] → Build the plan up front and create/start watch tasks in prerequisite layers, waiting for initial readiness before resolving the next layer.
- [A watch task can fail during staged startup] → Stop all already-created tasks, report the failing component, and do not leak watchers or terminal bindings.
- [Flattened provenance increases artifact complexity] → Version the JSON schema and validate it strictly at load boundaries.
- [Removing positional arguments can break unpublished local scripts] → Fail clearly at the CLI boundary and update all repository fixtures and documentation in the same change.
- [A shared compiler contract could leak into the generic vendor layer] → Keep it in the dedicated `bit-lite-compiler` package and enforce one-way dependencies from core/compiler implementations to that package.

## Migration Plan

1. Replace the CLI/vendor argument types and fixtures in place; do not add a compatibility version.
2. Add the compiled environment schema, flattening logic, and loader support.
3. Move environment compilation into a maintained `demo-vendors` compiler and assign environment components a bootstrap environment that configures it.
4. Route one-shot compile and install preparation through the unified compiler planner.
5. Add compiler watch lifecycle support, the composable contribution factory, and standalone supervision.
6. Add TypeScript and environment vendor watch implementations and move the watcher dependency to the vendor package.
7. Update documentation and run package plus workspace verification.

Rollback consists of reverting the change as a unit; no persisted external state or compatibility migration is introduced.

## Open Questions

- How compiler watch contributions are combined with preview/test inside `start` will be designed in a separate change.
- Dependency-aware invalidation conventions for third-party compilers may later merit optional shared helpers, but they are not part of the core contract now.

## Context

The command-side vendor execution kernel already models compile as component-level units, preview and test as env-level units, eager or deferred watch activation, prerequisite layers, first validated results, and caller-owned contributions. `createCompileWatchContribution()` currently starts compiler tasks in dependency order, while the standalone `compile --watch` wrapper adds the resident supervisor and optional managed terminal.

`bit-lite start` separately resolves one canonical component/env selection and composes preview and test contributions behind one proxy and terminal. It does not request compile tasks, and its combined manifest has no representation for them. A preview or test vendor can therefore begin importing a cross-env workspace package before that package has produced an initial `dist` artifact.

Two adjacent changes constrain this design. `add-compile-watch-terminal-output` makes raw compiler stdout/stderr useful in the existing per-task buffer but explicitly keeps structured task state authoritative. `simplify-watch-shutdown-lifecycle` makes each contribution's cached `dispose(): Promise<void>` the complete task/resource owner and makes the root supervisor the only terminal and SIGINT/SIGTERM owner. This change composes those contracts and must not reintroduce supervisor-side task stopping, child supervisors, or duplicated cleanup.

The CLI parser already reserves `-w` for `--workspace`, retains the original raw argument array, separates global workspace/filter selection from command options, and retains passthrough values after `--`. The new `watch` spelling must preserve those properties while selecting the existing compile-watch execution path.

## Goals / Non-Goals

**Goals:**

- Start compile, preview, and test from one resolved selection under one resident session.
- Establish a successful initial result/readiness barrier for every included compile task before preview or test contribution creation.
- Skip selected components that do not configure compile without losing their preview, test, source-browser, or UI participation.
- Preserve compile dependency planning and make missing or failed mandatory prerequisites fatal to the initial barrier.
- Keep compile and test eager and apply `--lazy` only to preview.
- Support compile-only start with the normal proxy, source browser, manifest, UI, terminal policy, signals, and aggregate disposal.
- Expose live compile task identity and status without inventing component compile history or mutable controls.
- Add `bit-lite watch` as a strict, argument-preserving alias of the existing standalone compile-watch workflow.
- Cover interactive and non-interactive ownership, ordering, rollback, and presentation behavior.

**Non-Goals:**

- Creating a generic service/plugin contribution registry or changing env service extensibility.
- Changing compiler vendor protocols, structured result schemas, dependency invalidation after startup, or maintained compiler output wording.
- Making compile or test lazy.
- Adding compile rerun, stop, restart, retry, or other control routes.
- Attributing an env task's or compiler task's raw terminal stream to structured component history.
- Changing `-w`, adding another short watch flag, or making `watch` capable of one-shot compilation.
- Making a runtime rebuild failure automatically stop an already-ready start session; existing task error and recovery behavior remains authoritative.

## Decisions

### 1. Start derives compile roots from the resolved selection, then reuses the compile contribution

Start continues to call the existing workspace preparation and selection boundary once. From the returned canonical selected components and resolved effective envs, it derives compile roots only for selected components whose effective env defines `services.compile`. Components without that service are recorded as compile-unavailable/skipped for presentation purposes but remain in the same canonical selection supplied to preview, test, source browsing, and the manifest.

Those root component IDs are passed to the existing compile watch contribution path. The compile planner remains responsible for adding required local env prerequisites and ordering included units by local runtime and environment dependencies. A local env prerequisite added for a compile-enabled root is mandatory even when it was not directly selected:

- an unavailable local prerequisite component is a planning error;
- an included prerequisite whose effective env has no `services.compile` is an initial compile error;
- a prerequisite preparation or first-result failure blocks its dependents and rejects the start barrier; and
- independent tasks may perform their initial work, but start does not proceed to preview/test if any included compile unit fails the initial barrier.

This optional-root/mandatory-prerequisite distinction is start-specific selection policy. Standalone `compile` keeps its existing explicit missing-compiler reporting rather than silently changing one-shot or `compile --watch` semantics.

Alternative considered: pass every selected component to the current compile planner and treat missing services as preparation failures. That would prevent valid preview/test-only components from participating in start and contradict service-optional composition.

### 2. The compile contribution exposes one cached all-task readiness barrier

Compile contribution creation continues to create tasks in prerequisite layers. The contribution also exposes an all-task readiness operation or promise built from the vendor execution kernel's single-flight `ensureUnitReady()`/first validated result mechanism. Start awaits that barrier immediately after compile contribution creation and before it opens preview or test contributions.

The barrier includes every contributed compile task, including final-layer and single-layer plans. Success means each included compiler has produced its first validated successful result; a mere worker start or textual stdout line is insufficient. Initial errors reject the barrier. After the barrier succeeds, later rebuild errors update the task's live structured status and can recover on the same watcher without tearing down the entire start session.

The barrier is cached so start, tests, or another composed caller cannot activate or subscribe to the same task readiness twice. The existing cached aggregate contribution disposer remains the only cleanup operation.

Alternative considered: rely on layered contribution creation alone. The current kernel waits between dependency layers, but a one-layer plan or final layer can return before every first successful result, leaving the cross-env startup race intact.

### 3. Start uses an explicit staged startup and reverse-dependency rollback

The staged sequence is:

1. prepare and resolve one canonical selection;
2. derive compile-enabled roots;
3. create the compile contribution and await its complete initial readiness barrier;
4. if no compile, preview, or test service can contribute a task, report the empty selection and return;
5. open the central proxy;
6. create preview and test contributions, with preview receiving eager or lazy activation and test always receiving effective watch mode;
7. register start, preview, and test routes;
8. supervise the stable union of compile, preview, and test tasks once.

This starts compile work before any preview/test vendor can import compiled outputs. A compile-only session proceeds through steps 5-8, so it still provides the start shell, source browser, manifest, and optional managed terminal.

One cached root disposer owns all successfully created contributions and the proxy. It attempts cleanup in reverse dependency order: test and preview contributions, then compile, then the proxy. Cleanup stages may be grouped where no ordering relationship exists, but every stage is attempted and failures are aggregated. Start uses this same disposer for compile-barrier failure, later contribution construction failure, route-registration failure, signal-driven shutdown, and caller cleanup. It never separately stops the combined task array.

If compile contribution construction fails before returning, its factory must clean partial tasks/resources according to the contribution contract. If it returns and its initial barrier fails, start invokes the returned cached disposer. If a later startup stage fails, rollback includes every contribution already created plus the proxy. The initiating error and cleanup failures are reported after all cleanup attempts settle.

Alternative considered: start the proxy, preview, and test concurrently with compile and hide their routes until compile becomes ready. This shortens best-case startup but permits vendor imports before artifacts are safe and makes rollback and lazy activation races more complex.

### 4. One root session presents all contributed tasks without owning their cleanup

Start forms one stable task array in compile, preview, and test contribution order and passes it to one root `superviseVendorTasks()` call. The supervisor owns at most one `ManagedTerminal` and the session's SIGINT/SIGTERM listeners. Contributions, runners, and vendors install neither. In a non-interactive process, the same tasks remain resident with no managed terminal.

Compile and test tasks are always eager. `--lazy` is read only when constructing preview; it does not alter the compile/test effective arguments or delay the compile readiness barrier. The terminal uses each existing task's service-scoped identity and raw-output buffer, so compile stdout/stderr from `add-compile-watch-terminal-output` appears under the corresponding component-level compile task.

Following `simplify-watch-shutdown-lifecycle`, the supervisor invokes the root disposer and does not stop tasks itself. Each child contribution owns its tasks exactly once, and the root does not create nested standalone wrappers.

Alternative considered: invoke `runCompileCommand()` from start. That wrapper owns a resident supervisor and terminal, so it would create nested signal handlers and block start before composition.

### 5. The start manifest models compile tasks as live status, not result history

The combined manifest gains a top-level compile task collection containing at least task ID, component ID, selected env identity, vendor identity, and current task status. It includes prerequisite compile tasks even when their component is outside the directly selected component catalog. Each directly selected component may also carry a compile binding that references its task identity and current status; a selected component skipped for missing compile has no actionable compile binding.

The manifest's component catalog is seeded directly from the canonical selected components rather than inferred from preview/test groups. This keeps compile-only components and service-less-but-browsable components visible with their source links. Preview and test bindings continue to overlay their existing links and status.

The polling start UI renders compile identity/status as read-only information. It does not expose compiler output, results, artifact paths, history, or controls. Raw compiler output remains available only through the unified task terminal. Core does not parse that text, associate it with a structured compile attempt, or copy it into component-level records.

Alternative considered: reuse the component test-result page/store for compile. Compile results and raw output have different scope and retention semantics, and doing so would falsely imply a structured historical record that the current compiler contract does not provide.

### 6. `watch` normalizes only the effective watch option and calls the same runner

CLI dispatch registers `watch` to a narrow wrapper around the same compile command/watch runner used by `compile --watch`; it does not duplicate selection, linking, planning, contribution creation, terminal, signal, or disposal logic.

The wrapper rejects an explicitly false watch value such as `--no-watch` before workspace preparation. Otherwise it creates an effective parsed value whose command options copy every user option and set `watch: true`. It retains:

- the user's original raw argv, including the `watch` command spelling;
- passthrough arguments and order;
- unknown vendor options;
- parsed workspace root and repeated component filters; and
- the source parsed object without mutation.

An explicit `--watch` is accepted as redundant. The parser's existing `-w` alias continues to mean `--workspace`; no watch short option is introduced. Help and README label `watch` as an alias for `compile --watch`, including the `--no-watch` conflict.

Alternative considered: rewrite raw argv to `compile --watch` and parse again. That can lose the exact user invocation, duplicate parser behavior, and change what vendors observe through `context.args.raw`.

## Risks / Trade-offs

- **[Risk] Waiting for every compiler's first result increases start latency.** → Treat this as the correctness boundary and expose compiler progress through the existing terminal output.
- **[Risk] A compiler that never produces a first result can hold startup indefinitely.** → Preserve existing compiler readiness semantics and cancellation through SIGINT/SIGTERM; timeout policy remains outside this change.
- **[Risk] Start and the lifecycle change modify overlapping start requirements and cleanup code.** → Implement this change on top of the cached contribution disposer/root-owner contract and keep merge resolution explicit in tests and specs.
- **[Risk] A missing compiler on a local env prerequisite can surprise users whose selected component itself has compile configured.** → Report the prerequisite component and dependency relationship, and distinguish it from a directly selected component that is intentionally skipped.
- **[Risk] Compile-only sessions open an HTTP server even without preview/test routes.** → This is intentional so start retains its central source browser, UI, and manifest contract.
- **[Risk] Manifest duplication between top-level tasks and component bindings can drift.** → Build both views from the same live compile bindings and avoid stored snapshots.
- **[Trade-off] Runtime compiler failures after readiness do not stop preview/test automatically.** → Keep current recoverable watcher behavior; the manifest/terminal expose the failure without inventing cross-service restart policy.

## Migration Plan

1. Land or reconcile `simplify-watch-shutdown-lifecycle` so contribution disposal and root supervision have one ownership model.
2. Add the strict `watch` dispatch wrapper, conflict validation, help text, README entry, and argument-preservation tests.
3. Extend compile contribution planning with start's optional-root policy and a cached all-task readiness barrier; add prerequisite and single-layer coverage.
4. Stage start startup around compile readiness, combine all task arrays, and replace rollback with one cached aggregate disposer.
5. Extend manifest construction and the start shell with live compile identity/status and compile-only canonical component seeding.
6. Add focused unit and end-to-end coverage, then run affected pnpm tests, type checks, builds, and OpenSpec validation.

Rollback removes the alias and start's compile stage/presentation while retaining the standalone compile contribution and lifecycle simplification. No persisted data or workspace configuration migration is required.

## Open Questions

None. The readiness boundary, prerequisite failure behavior, alias conflict behavior, and presentation scope are fixed by this change.

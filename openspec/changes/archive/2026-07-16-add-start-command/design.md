## Context

`preview` and `test --watch` are currently complete, blocking command workflows. Each calls `prepareWorkspaceForEnvLoading`, selects canonical `WorkspaceComponent` objects, derives `WorkspaceEnvGroup` objects from `WorkspaceContext`, and eventually creates `VendorTask` objects. `watchVendorTasks` then immediately wraps those tasks in its own `ManagedTerminal`, installs process signal handlers, waits for shutdown, and stops the tasks. `preview` additionally creates `PreviewProxyServer`, whose single class owns the listening socket, preview state, HTML shell and manifest, HTTP reverse proxying, and WebSocket upgrades.

The current ownership model works for standalone commands but would make a composed command prepare and resolve the same workspace twice, create competing terminal/signal owners, and require a second presentation layer to reach preview servers. The mainline context model already provides the right shared boundary: `WorkspaceContext.workspace` is the canonical workspace snapshot, its component contexts retain selected env resolution, and `WorkspaceEnvGroup` is a derived view over the selected canonical components.

`VendorContext` is the parent-owned, JSON-safe projection passed into a task. It deliberately separates the selected child env identity in `context.env` from the declaring service package in `context.service.source`, which matters when a service is inherited. The test result contract contains per-component structured results, while the test process and its raw terminal buffer remain env-scoped. `ResultStore` records successive events with task, selected env, and vendor metadata, and every `VendorTask` owns a bounded `RawOutputBuffer`.

The first version needs only `preview` and `test`. It should establish a composition seam without designing a general command action system before a third use case exists.

## Goals / Non-Goals

**Goals:**

- Add one `start` process that composes preview and test watch work for the same CLI selection.
- Prepare and resolve that selection once, then pass the same canonical workspace, component, and env-group references to both contributions.
- Give `start` sole ownership of the interactive managed terminal, process shutdown, and listening proxy server.
- Preserve the standalone `preview` and `test` workflows by building them from the same lower-level pieces.
- Separate generic HTTP/WebSocket proxy transport from preview state and presentation.
- Expose current preview links and read-only test information through one central UI.
- Use structured selected-env identity in public read models while preserving declaring-service source semantics for resolution.
- Show the latest structured result observed for each component and the bounded terminal output of its env-level test task.
- Keep the contribution contract small enough to extend when another long-running command is actually introduced.

**Non-Goals:**

- Triggering test reruns or defining tester input messages, actions, or capability negotiation.
- Changing test execution from env-level tasks to component-level tasks.
- Synthesizing a complete test snapshot when a watch runner reports only an incremental update.
- Combining output from multiple vendor tasks into one artificial terminal stream.
- Making every existing one-shot command composable.
- Preserving a public programmatic API for the current internal `PreviewProxyServer` class; CLI behavior and documented HTTP behavior are the compatibility targets.
- Introducing a second workspace/context model or cloning canonical component and env-group objects for each child command.

## Decisions

### 1. The parent prepares one resolved command selection

The CLI package will add an internal preparation boundary with a shape equivalent to:

```ts
type ResolvedCommandSelection = {
  parsed: ParsedCliArgs;
  context: WorkspaceContext;
  components: readonly WorkspaceComponent[];
  groups: readonly WorkspaceEnvGroup[];
};
```

Creating this value calls `prepareWorkspaceForEnvLoading` exactly once, selects components from `context.workspace`, and derives env groups once from that context and selection. `components` remain references to canonical `Workspace.components`; `groups` retain the corresponding resolved `EnvContext` objects. This is a small command orchestration value, not another workspace model.

`start` owns this preparation and passes the same value to both contributions. Neither contribution reads, links, materializes, resolves, reselects, or regroups the workspace. Standalone wrappers create one resolved selection for themselves before invoking the same contribution entry point.

Alternative considered: let preview and test contributions each accept `ParsedCliArgs` and call their current preparation path. That would repeat workspace mutation and resolution, permit the two contributions to observe different snapshots, and weaken the canonical-reference guarantees established by the current context model.

### 2. Child commands expose contribution entry points; standalone runners remain wrappers

The preview and test command modules will each expose a non-blocking contribution entry point in addition to their existing CLI runner. The common portion is intentionally small:

```ts
type WatchCommandContribution = {
  serviceId: string;
  tasks: VendorTask[];
  routes: ProxyRoute[];
  dispose(): void | Promise<void>;
};
```

The preview contribution additionally exposes its preview state, standalone-manifest read model, and unavailable/preparation-failure groups. The test contribution exposes component-to-task bindings and its result store. `start` uses those typed additions to render its known preview/test UI; they are not forced into generic navigation or action metadata.

`runPreviewCommand` creates one resolved selection, opens a standalone proxy, obtains the preview contribution, adds the preview-only root and manifest routes, and supervises its tasks. The watch branch of `runTestCommand` creates one selection, obtains the test contribution, and supervises it without a proxy. `runStartCommand` passes its shared selection to both contributions, registers their service routes, and supervises the concatenated tasks.

This is command-to-command composition through exported command-module entry points. It does not recursively invoke the CLI and it does not call a child command's blocking standalone wrapper. For the test contribution, `start` creates a new `CliArguments` value that preserves `raw`, `positional`, `passthrough`, and all unknown options while overriding only the parsed `options.watch` field to `true`; it does not mutate the shared parsed selection.

Alternative considered: add an `embedded` flag to the existing blocking command functions and vary their return type. This obscures resource ownership and makes error cleanup depend on a mode flag throughout each implementation. Separate contribution and standalone entry points keep the ownership boundary explicit.

### 3. Watch-task creation is separated from terminal and process supervision

`bit-lite-vendors` will split the current `watchVendorTasks` workflow into two reusable phases:

1. Create and start worker-backed vendor tasks, install result formatting/callback behavior, and return the tasks.
2. Supervise an already-created task array with at most one `ManagedTerminal`, one set of signal handlers, and one idempotent shutdown path.

The existing `watchVendorTasks` function remains as a convenience composition of these phases. Child contributions use the first phase; standalone commands and `start` use the second. The supervisor supports TTY and non-TTY watch sessions and has one idempotent shutdown path. Dependency-safe cleanup order is: stop terminal input/rendering, stop and if necessary terminate tasks, detach task and process listeners, dispose contribution resources such as prepared preview directories, and finally close the listening proxy.

Task identity is derived from `task.context.service.name`, `getSelectedEnvKey(task.context.env)`, and the loaded vendor ID so preview and test tasks cannot collide in the combined terminal. It does not accept a second competing service-identity field solely for ID generation. Combined labels expose service, vendor, and selected env sufficiently to distinguish adjacent tasks. Output and interactive input remain attached to one selected underlying task at a time.

Alternative considered: let each child retain a hidden `ManagedTerminal` and multiplex their rendered output. Multiple raw-mode readers and signal owners would conflict, so tasks—not terminals—are the composition unit.

### 4. A transport-only `bit-lite-proxy` package owns the listening server

A small new `bit-lite-proxy` package will contain:

- available-port selection and listening socket lifecycle;
- ordered HTTP and WebSocket route registration;
- HTTP and WebSocket reverse-proxy helpers;
- small HTML/JSON/error response helpers.

A route has a stable ID, a match function or explicit path/prefix, an HTTP handler, and an optional upgrade handler. Exact application routes are owned by the caller. Duplicate route IDs are rejected and unmatched requests receive a controlled 404. The package contains no preview, test, command, manifest, or UI concepts.

`bit-lite-preview` retains preview-specific state, prepared component link generation, startup/failure status, the preview-only shell, and env reverse-proxy route creation. It stops owning generic listening and transport code. Preview service routes cover `/env/<encoded-package-name>/...` and continue to support both HTTP and WebSocket forwarding. The public path uses the selected env package name under the context model's current single-selected-version constraint; maps and task identity use the full selected-env key.

The preview contribution does not claim `/` or `/__bit-lite/manifest.json`. The standalone preview wrapper registers its current root shell and manifest, while `start` registers its combined root shell and manifest. Standalone preview keeps the current structured `env` object on every env entry and does not gain a legacy `envName` property or a top-level `skipped` field. Preview-only unavailable and failure information is returned separately to `start`, which may include it in the new combined manifest without changing the standalone contract.

Alternative considered: enhance `PreviewProxyServer` directly with test routes. That would make future services depend on a preview-owned UI and state model and would preserve the three-way transport/state/presentation coupling we want to remove.

### 5. Startup prepares the workspace before opening the central proxy

Preview-generated runtime data requires the final public proxy origin and stable env base paths, but service availability can be determined from the resolved selection before opening a socket. Startup therefore proceeds in this order:

1. Create the resolved command selection once and partition its groups by configured preview/test services.
2. If no selected group configures either service, report that no start tasks were found and exit without opening the public server.
3. Parse the start host and preferred port and start the empty central proxy.
4. Obtain preview and test contributions from the shared selection. Preview receives the actual proxy origin; test receives the non-mutating effective watch arguments described above.
5. Register preview/test service routes and the start root, manifest, and test-page routes.
6. If at least one task was created, supervise all tasks together. If expected preparation failures leave no runnable tasks, expose or report those failures, dispose resources, close the proxy, and exit without entering a watch session.

Expected per-env preview preparation failures are retained in preview state and do not prevent valid preview or test tasks from starting. An unexpected contribution-construction or route-registration failure stops already-created tasks, disposes already-created contributions, and closes the proxy before the error is returned.

Callers do not need to spell `start --watch`. In a TTY, the central supervisor creates one managed terminal. In a non-TTY, tasks still run in watch mode and are governed by process signals, but no interactive terminal UI is created.

### 6. Selected env identity and declaring service source have distinct roles

All task summaries, preview state, combined manifest entries, and test-result responses use the structured selected env identity from `task.context.env`: `packageName`, `requestedVersion`, and `installedVersion`. Public models do not reconstruct an env from a display name or emit `envName` as an alternate identity. Internal lookup keys use `getSelectedEnvKey` where a string key is required.

Vendor and configuration resolution uses the resolved service definition and `task.context.service.source`, which may point to an inherited parent env package. It must not replace the selected child env shown in task identity or UI state. Tests cover an inherited service to ensure origin lookup follows the parent while the public task/result identity remains the selected child.

### 7. Test pages join the matching task's result events and env output at read time

The test contribution keeps using `ResultStore<TestServiceResult>` for structured events and creates a binding from each selected component ID to its actual started test task. To obtain the current result for a component, it first resolves that binding, then scans store entries from newest to oldest, restricts candidates to `entry.taskId === binding.task.id`, and selects the first event whose `componentResults` contains the component. This avoids accidental joins when multiple services, selected env identities, or vendors produce similarly shaped events. It is deliberately the latest observed component update, not the newest env event and not a fabricated full-run snapshot.

Terminal output is read from the matching test task's existing bounded `RawOutputBuffer`. The implementation will decode its stdout/stderr chunks into browser-safe plain text at response time rather than copy the same bytes into another unbounded store. This also preserves the current output retention limit.

`start` will expose:

- `GET /` for the combined development UI;
- `GET /__bit-lite/manifest.json` for the combined preview/test read model;
- `GET /tests?component=<component-id>` for a component test page;
- `GET /__bit-lite/test-results.json?component=<component-id>` for the page's pollable read-only data;
- preview HTTP/WebSocket routes under the existing env base paths.

The test-result response identifies the component, structured selected env, task status, vendor, latest matching structured result and observation time, env-level terminal text, and notice strings describing both data scopes. Env and vendor metadata come from the bound task; the vendor event payload is not required to echo orchestration identity. The HTML page renders server data using DOM text APIs, not raw HTML interpolation, and periodically refreshes the GET endpoint. Before the first matching result it shows a pending/empty state and any terminal output already available.

No state-changing test route is registered. There is no rerun button, action endpoint, worker control message, or tester-specific capability in this change.

Alternative considered: split or infer env terminal text per component. The runner cannot reliably attribute ordinary terminal lines to components, so presenting such a split would be misleading.

### 8. The combined UI is start-specific rather than a universal plugin shell

The first `start` shell understands preview and test explicitly. It retains the existing env/component preview links and adds a test link only when the component belongs to a configured test task. Its manifest may nest preview data and test-task summaries rather than preserving the standalone preview manifest schema, because the `start` endpoint is new. Standalone preview continues to return its existing manifest shape.

Future commands can already contribute tasks and non-conflicting routes. A generic home-page section API, action protocol, or capability registry will be designed only when a third command demonstrates the metadata it actually needs.

## Risks / Trade-offs

- **[Risk] Contribution creation starts tasks before every sibling contribution succeeds.** → Make contribution disposal idempotent and have `start` dispose already-created contributions on any later construction failure.
- **[Risk] A contribution accidentally prepares or clones workspace state again.** → Centralize `ResolvedCommandSelection` creation, accept it as the contribution input, and assert one preparation call plus canonical component/group references in command tests.
- **[Risk] The existing result store is append-only during long watch sessions.** → The first implementation reuses it unchanged and reads newest-first; add bounded retention separately if real sessions show material growth.
- **[Risk] Terminal output contains ANSI/control sequences or partial UTF-8 chunks.** → Convert through a small text-normalization helper, strip terminal control sequences for browser display, and keep the underlying bounded byte buffer unchanged.
- **[Risk] One env update may omit a component during incremental reruns.** → Select the latest entry that actually contains the component and label its observation time and “latest observed update” semantics.
- **[Risk] Route matching order can create collisions as services grow.** → Give routes stable IDs, reserve `start` control paths, use disjoint prefixes/query routes, reject duplicate IDs, and cover precedence with tests.
- **[Risk] A preview runtime can apply the env base path twice when constructing its HMR URL.** → Define the central proxy as transparent forwarding under one base path and verify a real preview vendor's WebSocket upgrade/update flow end to end, not only a synthetic upgrade server.
- **[Trade-off] A new package adds a workspace boundary for a relatively small amount of code.** → Keep `bit-lite-proxy` transport-only; the boundary prevents preview-specific state and UI from becoming the de facto extension API.
- **[Trade-off] The start shell knows preview and test directly.** → Keep the contribution lifecycle reusable, but defer generic navigation/action metadata until a third composed command demonstrates a stable shape.

## Migration Plan

1. Add the shared resolved-selection boundary and prove preview/test consume canonical mainline workspace/context objects.
2. Add and test the generic proxy transport package while preserving current preview proxy behavior through preview-specific routes.
3. Split vendor watch-task creation from supervision and migrate existing preview/test watch tests to the shared supervisor.
4. Add preview and test contribution entry points, then rebuild their standalone wrappers on those entry points.
5. Add `start`, the combined read models/routes/UI, and end-to-end coverage for central terminal/proxy ownership.
6. Update CLI help and package documentation.

The change is internal and additive. Rollback consists of removing `start` and restoring the existing `watchVendorTasks`/`PreviewProxyServer` implementations; workspace configuration requires no migration.

## Open Questions

None required for the first implementation. Route names and internal type names may be adjusted during implementation as long as the specified ownership, read-only behavior, and standalone compatibility remain intact.

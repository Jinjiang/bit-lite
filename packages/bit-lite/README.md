# bit-lite

Small CLI entrypoint for running bit-lite workspace commands.

## Commands

```sh
bit-lite test --workspace <dir>
bit-lite test --workspace <dir> --filter <component-pattern>
bit-lite test --workspace <dir> --watch
bit-lite compile --workspace <dir>
bit-lite compile --workspace <dir> --filter <component-pattern>
bit-lite compile --workspace <dir> --watch
bit-lite watch --workspace <dir>
bit-lite watch --workspace <dir> --filter <component-pattern> -- --vendor-option
bit-lite install --workspace <dir>
bit-lite install --workspace <dir> --compile
bit-lite preview --workspace <dir>
bit-lite preview --workspace <dir> --filter <component-pattern> --port 4000
bit-lite preview --workspace <dir> --lazy
bit-lite start --workspace <dir>
bit-lite start --workspace <dir> --filter <component-pattern> --port 4000
bit-lite start --workspace <dir> --lazy
```

`bit-lite watch` is a strict alias for `bit-lite compile --watch`. It preserves
the original raw invocation, named vendor options, passthrough arguments,
workspace, and repeated filters while forcing the effective `watch` option to
`true`. `bit-lite watch --no-watch` is rejected instead of falling back to a
one-shot compile. The existing `-w` shorthand continues to mean `--workspace`;
there is no short watch flag.

Every component has an explicit `{ packageName, version }` env reference.
`workspace:` resolves only to a registered `kind: "env"` component; every other
version is installed as that component's logical development dependency. Env
packages default-export a static JSON definition with `test`, `preview`, and/or
`compile` services. Env JSON never owns component file patterns; vendors retain
test/spec discovery.

`bit-lite test` compiles required local env components through their configured
compiler services, loads env JSON,
groups components by selected env package, and runs each effective
`services.test` vendor with origin-resolved config.
Use `--filter` to restrict the command input to matching component ids. Exact
component ids and the workspace pattern syntax (`*` and `**`) are supported, and
the flag may be repeated.

Command setup follows two workspace phases. It first reads the JSON-safe base
`Workspace` used by install/link/compilation, then resolves the parent-only
`WorkspaceContext` needed for inherited services. Derived selections and env
groups reuse the canonical workspace component objects.

## Vendor command execution

Compile, test, and preview share a command-side vendor execution kernel. A
`VendorExecutionPlan` always contains ordered layers of `PlannedUnit` values.
Every unit has a unique string ID and explicit dependency IDs; dependencies must
refer to earlier layers. Test and preview use one layer, while compile projects
its component and local-env prerequisite graph into multiple layers. Plans are
validated before vendor resolution or command-owned preparation begins.

Service IDs at this boundary are non-empty open strings. The env-service planner
reads the already resolved selection and includes only groups whose resolved
service map contains that string. A selected group without the service is
silently omitted; commands do not construct unavailable-service state.

`defineVendorExecution()` supplies one preparation function for run and watch
modes. It receives immutable cloned command arguments with the effective
`watch` value, the planned unit, and command context.
`prepareResolvedServiceTaskOptions()` provides the standard vendor URL,
`VendorContext`, components, config, and optional runtime projection. Definitions
can add command metadata and watch-layer finalization, which preview uses for
prepared files and deterministic port hints.

`runVendorExecutionPlan()` executes eligible units concurrently inside each
layer and returns successful, failed, or dependency-blocked outcomes.
`createVendorWatchExecution()` creates stable eager or deferred tasks, supports
automatic first-validated-result sequencing between layers, and returns
prepared-unit bindings, single-layer preparation failures, tasks, and one
idempotent disposer. `ensureUnitReady()` single-flights deferred activation plus
first-result observation for one prepared unit, caches success or failure, and
rejects disposal races. Commands extend those inputs with their own bindings,
stores, state, routes, and manifests. The disposer is the aggregate ownership
boundary for contributed tasks and auxiliary resources; the execution kernel
does not install signals, create a managed terminal, or supervise a resident
session.

Every component, including an env component, uses the `services.compile`
configured by its own effective env. There is no component-kind compiler
selection in core. The demo assigns env components to `demo-env-env`, whose
ordinary compile service points at `demo-vendors/compilers/env`; that vendor
flattens inheritance into versioned `dist/index.json` and transpiles adjacent
TypeScript support files.

One-shot compile and `compile --watch` invoke the same default vendor entry
through the generic runner. The compiler vendor reads
`context.args.options.watch` and selects its run mode internally. Each compiler
vendor owns file watching, incremental behavior, recovery, and cleanup. The
compile command contributes caller-owned tasks and the standalone command
supervises them centrally; a managed terminal is used only in an interactive
session. `bit-lite start` consumes that same contribution directly instead of
invoking the standalone wrapper, so composed sessions do not create nested
terminals, signal handlers, or task cleanup. Compile-specific contracts and validators are exported by
`bit-lite-compiler`; `bit-lite-vendors` remains service-agnostic.

Run `bit-lite compile` before preview when a component imports a workspace
package owned by another env. Preview aliases only the current env's selected
components to source because other envs may require incompatible loaders or
plugins; cross-env imports continue to resolve through compiled package `dist`
artifacts. `bit-lite start` performs this compile-watch preparation itself and
waits for every included task's first validated successful result before
creating preview or test contributions.

`bit-lite preview` prepares one HTML and one browser entry per selected env,
then starts the configured preview dev-server vendor behind a shared proxy.
Public component links use hash routes under the env base, for example:

```txt
/env/react/#components%2Fui%2Fbutton
/env/react/#components%2Fui%2Fbutton?preview=docs
/env/react/#components%2Fui%2Fbutton?preview=compositions&name=primary%2FMySecondDemo
```

Preview preparation owns docs/demo discovery and literal dynamic imports. A
preview vendor receives server binding hints, the prepared entry/HTML paths, and
the current env's `{ packageName, sourceDir }` alias descriptors; it does not
receive raw components or MDX options in runtime JSON.

`preview --lazy` keeps that preparation eager so the root UI and manifest can
show complete navigation, but leaves each env's worker, bundler, watchers, and
internal dev server idle. The first HTTP request or WebSocket upgrade anywhere
under a known `/env/<encoded-env>/...` namespace starts exactly that env and
waits before forwarding the original traffic. This includes direct assets,
lazy chunks, Vite HMR, and Webpack HMR. The first request therefore pays cold
worker and initial-build latency. Concurrent cold traffic shares one activation;
an activation failure is cached for that command run and is not retried by page
refreshes.

Lazy manifest entries progress through `idle`, `starting`, `ready`, `failed`,
and `stopped`. Prepared component links and deterministic port preferences are
available while idle, but an actual upstream is published only after the vendor
reports the port it bound. The internal preferred range starts at 6000 in stable
env order; conflicts fall back after the complete preferred range so activating
one env cannot consume an idle env's preferred port.

`bit-lite start` composes component-level compile, env-level preview, and
env-level test watch tasks for the same filtered component selection. Selected
components without `services.compile` skip only compile and retain any available
preview/test behavior. Compile-enabled roots and their required local env
prerequisites follow the compiler dependency plan, and all included compile
tasks cross their first-success readiness barrier before preview or test starts.
A missing or failed mandatory compile prerequisite rolls startup back.

Start opens one public proxy and at most one managed terminal, keeps preview
vendor servers internal, and serves a combined component index at the proxy
root. A compile-only selection is valid and still serves the central manifest,
source browser, and UI. The manifest and UI expose live compile task
identity/status, while raw compiler stdout/stderr remains scoped to its task in
the unified terminal and is not presented as component compile history or a
control surface. Component test pages remain read-only: structured results are
component-scoped, while terminal text is explicitly labeled as the latest
retained output for the whole selected env and may include sibling components.
Test watch mode is enabled automatically by `start`; a rerun control is not
provided. `start --lazy` applies only to preview; every compile and test task
still starts eagerly and shares the same fixed task array, terminal, proxy, one
SIGINT/SIGTERM owner, and aggregate disposal path.

Resident compile, test, preview, and start sessions terminate only for Ctrl+C,
SIGINT, or SIGTERM. Pressing `q` in the parent task menu does not stop the
session. The root session restores terminal state first, then awaits one cached
aggregate disposer. Each contribution owns stopping its logical tasks and
releasing prepared files, listeners, state, and other auxiliary resources; a
cleanup failure does not skip later owned cleanup.

The first lazy version does not defer discovery or generated-file preparation,
make tests lazy, evict active servers, retry failed activation, cap active
servers, or combine multiple envs in one dev server. Omit `--lazy` to retain the
default eager preview behavior.

Every component on the start index also has a read-only `source` link. The
source browser uses these start-owned routes:

```txt
/source?component=<component-id>
/__bit-lite/source-files.json?component=<component-id>
/__bit-lite/source-file.json?component=<component-id>&path=<relative-path>
```

Source access is limited to the canonical components selected by the current
command and its `--filter` values. File responses expose only component-relative
POSIX paths; they never expose absolute workspace paths. The index includes
regular component files but ignores symlinks and prunes `.git`, `.bit-lite`,
`node_modules`, `dist`, `build`, and `coverage` directories. UTF-8 text files up
to 1 MiB can be viewed. Invalid UTF-8 or NUL-containing files are reported as
binary, and larger files are listed with an explicit `too-large` state rather
than returning partial content. Index and content reads are uncached, so a
refresh observes source edits made while `bit-lite start` remains running.

Every command uses the common vendor envelope `{ context, components, config,
runtime? }`. Version-1 context contains the base workspace,
raw/named/passthrough argument forms, selected env identity, service name, and declaring-service package
location. Parent orchestration consumes lifecycle options such as `--watch`,
`--filter`, and preview server coordinates; unrecognized extension options stay
available to vendors through `context.args.options` and passthrough arguments.

The parent-side task resolves vendors and command-owned module fields from the
effective service's declaring package. This matters for inherited services: the
selected child remains `context.env`, while `context.service.source` identifies
the parent that declared the tester, previewer, or compiler. Worker data never
contains the heavier `WorkspaceContext`, loaded modules, maps, or resolver
callbacks.

That selected-env identity is
`{ packageName, requestedVersion, installedVersion }` end to end: vendor task
input/results, test result context and storage, compile vendor input, preview
prepared state, and the preview manifest. Public preview URLs remain
package-name-based; the adjacent manifest preserves both version values.

Test, preview, and compile vendor outputs contain only execution-produced data.
They do not repeat env, vendor, service, arguments, config, components, server,
or output paths. The parent attaches its retained task metadata after validating
the required fields and preserves additional JSON-safe fields such as coverage
or compiler artifact details.

Every runtime value export in a sorted `*.demo.*` file is one demo. For example,
`export const MySecondDemo = ...` in `primary.demo.ts` has ID
`primary/MySecondDemo` and display name `My Second Demo`. Prefer named exports;
`default` remains supported as `primary/default` / `Default` only for
compatibility. Keep helper values unexported and use explicit exports instead of
bare `export *`. Editing an existing export retains HMR, while adding, removing,
or renaming exports requires restarting `bit-lite preview`.

Build, test, and type check with pnpm:

```sh
pnpm --filter bit-lite test
pnpm --filter bit-lite typecheck
pnpm --filter bit-lite build
```

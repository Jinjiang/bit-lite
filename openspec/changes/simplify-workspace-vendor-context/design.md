## Context

The current implementation exposes three overlapping workspace representations. `WorkspaceConfig` describes `bit-lite.json`, `ComponentPackageRegistry` enriches components from `.comp.json` and filesystem state while adding public maps, and `WorkspaceRuntime` copies config and component fields again while storing loaded envs and precomputed groups. Commands then project those objects into `ComponentRef`, `SelectedEnvGroup`, preview-specific component records, compile inputs, and vendor task options.

Vendor execution has a similar overlap. `VendorData` contains selected env identity, components, CLI arguments, service config, and a command-specific `runtime` escape hatch, but it does not expose the stable workspace facts that vendors may need for future behavior. Test compensates by placing `workspaceRoot` in `runtime`; preview sends a prepared workspace alias projection and currently clears the common component list; compile uses a separate direct-call contract. Maintained vendors then echo env, vendor, service, arguments, config, component identity, and output locations in their results even though the parent task already owns those facts.

The runner uses structured cloning in inline mode and worker data in worker mode. The public vendor boundary must therefore remain serializable, but it does not need to serialize parent-only indexes, caches, resolver functions, loaded modules, or the full resolved env graph. Vendors are trusted executable dependencies, so providing normalized workspace paths and service origins is an extensibility contract rather than a security boundary.

The archived env-package work established requirements that remain unchanged: explicit component env package references, external versus `workspace:` locality, JSON env entries, recursive `extends`, declaring-service origin, fixed env-component materialization, per-component ordinary compile, command-owned preview preparation, and vendor-owned file discovery.

## Goals / Non-Goals

**Goals:**

- Establish one lightweight, JSON-safe `Workspace` as the canonical base workspace representation.
- Establish one heavier parent-only `WorkspaceContext` for resolved env packages and execution lookups without copying base workspace facts.
- Keep component objects canonical through selection and grouping so commands pass existing objects instead of rebuilding structurally equivalent records.
- Provide every test, preview, and compile vendor with a stable, versioned `VendorContext` containing base workspace facts, complete parsed command arguments, selected env identity, service name, and declaring-package origin.
- Preserve unknown command options and passthrough arguments as a vendor extensibility channel while keeping parent-owned orchestration explicit.
- Retain a small common active vendor input of selected components, effective service config, and optional command runtime.
- Resolve vendor modules and command-owned module fields in the parent while enabling vendor-specific config fields to resolve from the serializable service origin.
- Make vendor outputs contain only newly produced data and attach env/vendor/service metadata once from the parent-owned task context.
- Align compile with the same context/data envelope even if compile continues to execute inline with a compile-specific entry function.

**Non-Goals:**

- Changing `bit-lite.json`, `.comp.json`, or env JSON authoring schemas.
- Adding new commands, generic env targets, files, patterns, or a new compiler configuration schema.
- Passing `WorkspaceContext`, maps, resolution caches, functions, or loaded modules into workers.
- Preventing vendors from reading the filesystem or treating the vendor boundary as an untrusted-code sandbox.
- Making the parent unaware of options that change parent lifecycle, scheduling, terminal behavior, routing, or presentation.
- Moving preview discovery/preparation or maintained test file discovery to a different owner.

## Decisions

### 1. Expose two workspace levels and keep intermediate indexes private

The first public level is a plain `Workspace`:

```ts
type Workspace = {
  rootDir: string;
  configPath: string;
  config: WorkspaceConfig;
  components: readonly WorkspaceComponent[];
};
```

`WorkspaceComponent` contains the current normalized component/package facts needed by install, link, materialization, selection, and vendors: id, configured relative path, absolute root, package name, kind, main file, dependency maps, internal dependency names, and env package reference. Every field is JSON-safe. Reading this level may inspect `bit-lite.json`, `.comp.json`, component directories, and entry files, but it does not require installed env dependencies or load env definitions.

The second public level is parent-only:

```ts
type WorkspaceContext = {
  workspace: Workspace;
  components: readonly ComponentContext[];
};

type ComponentContext = {
  component: WorkspaceComponent;
  env: EnvContext;
};
```

Internal `Map` indexes, env caches, and dependency traversal state may be built while reading or resolving, but they are not canonical public data and do not cross the vendor boundary. `readWorkspace(root)` creates the base level. `resolveWorkspace(workspace)` loads installed envs and creates the second level after install/link/materialization when required.

This is preferred over retaining `ComponentPackageRegistry` as a third public level because registry maps are query accelerators, not separate workspace facts. It is also preferred over making all env fields optional on one model because phase validity would become implicit and every consumer would need narrowing logic.

### 2. Keep one canonical component object and derive selections and groups

`Workspace.components` owns every `WorkspaceComponent`. `WorkspaceContext.components[].component`, filtered selections, and env groups reuse those objects. Selection helpers return the original objects in deterministic order; grouping returns `{ env, components }` views and is computed from the requested selection rather than stored permanently on `WorkspaceContext`.

The heavy context does not expose duplicated `config`, `envs`, or `groups` fields. Unique env views and lookup indexes are derived helpers. This removes repeated `ComponentRef` projections and avoids a public record keyed by a package-name/version encoding.

This is preferred over serializing component IDs alone because maintained vendors frequently need roots and package names, and forcing every vendor to repeat a lookup would move conversion cost rather than remove it.

### 3. Represent env and service origin by composition

The resolved model retains one canonical `SelectedEnvIdentity` object on each `EnvContext`. A service references its source package object rather than flattening `declaredBy`, `packageRoot`, `entryUrl`, and `entryDirectory` into every service:

```ts
type PackageLocation = {
  identity: PackageIdentity;
  rootDir: string;
  entryFile: string;
};

type ResolvedService<Name extends SupportedEnvServiceName> = {
  name: Name;
  definition: EnvServiceConfigMap[Name];
  source: PackageLocation;
};
```

Entry directories and file URLs are derived at the call site. Inherited services retain the ancestor `source` object while the component retains its selected child `EnvContext`. Effective top-level env config and effective services are stored once; the context does not retain a second effective definition containing another copy of the service map.

### 4. Make VendorContext the stable extensibility floor

Every vendor invocation receives:

```ts
type VendorContext = {
  version: 1;
  workspace: Workspace;
  args: CliArguments;
  env: SelectedEnvIdentity;
  service: {
    name: SupportedEnvServiceName;
    source: PackageLocation;
  };
};
```

`workspace.config` preserves normalized user declarations, `workspace.components` provides canonical local package facts, and `args` preserves raw, positional, option, and passthrough forms. The selected env remains distinct from the package that declared an inherited service. The context is a read-only command-start snapshot, evolves additively within version 1, and vendors must ignore unknown fields.

The full `WorkspaceContext` is deliberately not passed. It would expose internal resolution layout, increase transport size, and make loader refactors breaking vendor changes. A context containing only root paths would be smaller but would recreate the current need to add new wrappers whenever vendors need component, config, argument, or origin facts.

### 5. Retain a simple common active vendor input

The worker-facing data becomes:

```ts
type VendorData<Config extends JsonObject, Runtime extends JsonObject = JsonObject> = {
  context: VendorContext;
  components: readonly WorkspaceComponent[];
  config: Config;
  runtime?: Runtime;
};
```

`context` contains objective/shared facts. `components` represents the command's current target selection. `config` is the effective config for the selected service after command-owned preparation. `runtime` contains only command-produced transient values such as preview server coordinates and generated files.

Test receives selected components and normally has no command runtime. Preview continues receiving prepared server/files/aliases while also retaining the selected components instead of replacing them with an empty list. Compile receives the same context, a single selected component, its opaque env config, and compile paths in its runtime. Compile may continue using `compileComponent(data)` rather than the long-running runner lifecycle, but its data envelope is identical.

This common shape is preferred over a nested service-specific `input` hierarchy because workspace, arguments, target components, and env config are intentionally useful extension points across all three services. Service-specific runtime types remain available through generics without turning the common protocol into optional fields for every future capability.

### 6. Preserve raw arguments but keep orchestration ownership explicit

The existing CLI parser already retains unknown options and passthrough arguments. Vendors may consume new vendor-specific options, such as coverage flags, directly from `context.args` without a new main-program adapter. Commands do not reject unknown vendor options merely because the main program does not interpret them.

The parent still interprets options that change task selection, worker/watch lifetime, concurrency, terminal interaction, proxy routing, install stages, or presentation. Both parent and vendor may read a shared option such as `watch` when it affects both lifecycle and runner behavior. This is an explicit ownership boundary, not duplicate data adaptation.

### 7. Separate immutable service facts from prepared config

Commands must not copy a `ResolvedService` and rewrite `service.definition.config` merely to pass resolved module paths. Vendor task input retains the immutable resolved service for parent-side origin and vendor resolution, while the prepared `config` sent to the vendor is a separate field.

The parent resolves the vendor module and fields that participate in command-owned orchestration, including current preview mounter/docs/template preparation. `VendorContext.service.source` is serializable, so a vendor may interpret future vendor-specific config fields relative to its declaring env package without a main-program schema change. A shared pure helper may resolve a specifier from `source.rootDir`, `source.entryFile`, and `context.workspace.rootDir`; no resolver callback crosses the worker boundary.

`bit-lite-vendors` no longer imports context's module resolver at runtime. Bit-lite orchestration passes a canonical vendor module URL plus `VendorContext` and active data to the generic task runner. A type-only dependency on the stable context protocol is acceptable.

### 8. Vendor outputs contain only produced data

Vendors do not echo service name, vendor id, selected env, arguments, config, selected component identity, or parent-selected output locations. Test output contains run/mode/statistics/component results and may preserve additional JSON-safe vendor fields such as coverage. Preview output contains only vendor-produced state not already fixed by preparation; readiness continues through lifecycle messages. Compile output may contain emitted artifacts or other compiler-produced data and may be empty on success.

The parent task retains its original `VendorContext` and loaded `VendorDefinition`. A task result is assembled once as `{ context, vendor, data }`, where `data` is the validated vendor output. Command validators validate required produced fields while preserving additional JSON-safe fields; they do not validate echoed input equality.

Watch storage retains the parent task context and vendor identity rather than requiring them inside the vendor output. Preview proxy and manifest state project the selected env/vendor/server fields they publicly expose from task/preparation state. Presentation projections are allowed at output boundaries; domain and transport layers do not each retain another copy.

### 9. Migrate all maintained services atomically at the repository boundary

The vendor context/data and result contracts are breaking. Maintained test, preview, compile, sample vendors, task helpers, result validators, result store fixtures, proxy fixtures, and docs migrate in the same change. Maintained vendors no longer emit the old echoed metadata shape, while validators leave additional JSON-safe fields opaque rather than reserving historical field names.

Existing command behavior, routes, terminal lifecycle, failure isolation, dependency ordering, hard-coded test discovery, and generated artifacts remain covered by regression tests.

## Risks / Trade-offs

- [Every worker receives a base workspace snapshot] → Keep the snapshot JSON-safe, immutable, and shared by reference before structured cloning; avoid loaded env graphs and indexes; add a large-workspace serialization test and optimize transport later only if measured.
- [VendorContext makes the Workspace schema a public vendor contract] → Version the context, document additive evolution, keep internal indexes and heavy resolution out, and use canonical domain names rather than implementation-specific maps.
- [Vendors may bypass command-owned preparation using raw workspace data] → Preserve normative ownership rules and regression tests; access to context enables extensions but does not transfer lifecycle, preview discovery, or install orchestration ownership.
- [Unknown options may conflict across vendors] → Preserve the exact parsed/raw forms, document that vendor-specific flags belong to the selected service vendors, and reserve centrally interpreted flags only when parent behavior depends on them.
- [Removing echoed result metadata breaks consumers] → Migrate maintained vendors, stores, manifests, and docs atomically; expose task context in parent-owned result wrappers while allowing validators to preserve additional JSON-safe vendor fields.
- [Service origin paths expose filesystem layout] → Vendors already execute trusted code with filesystem access; treat paths as execution context, not a security boundary.
- [Compile still uses a different lifecycle entry] → Unify the data envelope now; defer forcing short-lived compile into the long-running terminal/worker lifecycle until a concrete need appears.

## Migration Plan

1. Introduce `Workspace`, canonical `WorkspaceComponent`, internal indexes, and `readWorkspace()` while adapting install/link/materialization to the base level.
2. Introduce `WorkspaceContext`, composed env/service origin types, `resolveWorkspace()`, and derived selection/group helpers; migrate test/preview/compile preparation off `WorkspaceRuntime` and public registry maps.
3. Add `VendorContext`, separate prepared config from immutable service facts, and change vendor task creation to accept a resolved vendor URL plus context/data without runtime context-resolution imports.
4. Migrate maintained test vendors and results, then watch storage, to context-based inputs and produced-data-only outputs.
5. Migrate preview tasks/vendors/proxy state while preserving prepared runtime, selected components, routes, failures, and cleanup.
6. Migrate compile vendors to the common context/data envelope and remove echoed compile identity/output fields while preserving per-component layering.
7. Remove obsolete workspace/runtime/ref types, service-copy adapters, `runtime.workspaceRoot`, echoed-input equality validation, and compatibility projections.
8. Update public documentation and run focused plus repository-wide typecheck, test, build, and demo end-to-end verification.

Rollback is a source revert of the workspace and vendor contract migration. No persisted user data or config migration is required because authoring formats remain unchanged.

## Open Questions

- None required before implementation. The context version is fixed at numeric version `1`; additional versioning machinery is deferred until a breaking vendor-context revision is proposed.

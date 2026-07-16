# bit-lite-context

Canonical workspace and resolved env context for Bit-lite.

`bit-lite.json` uses an explicit component array. Each record requires `path`,
`id`, `packageName`, and `env: { packageName, version }`. Legacy top-level
`envs`, `envName`, pattern assignment, defaults, aliases, and overrides are
rejected with migration-focused errors.

`.comp.json` may set `kind` to `component` or `env`; omitted means an ordinary
component. A `workspace:` env ref must name a registered `kind: "env"`
component. Normal versions remain external even when a local component or root
pnpm workspace package has the same name.

The workspace API has two explicit phases:

- `readWorkspace(rootDir)` returns a lightweight, deterministic, JSON-safe
  `Workspace`. It contains normalized config and one canonical
  `WorkspaceComponent` per registered component, but does not load installed env
  packages. Install, link, dependency generation, and local env materialization
  use this level.
- `resolveWorkspace(workspace)` returns a parent-only `WorkspaceContext`. It
  composes the same workspace and component objects with loaded env identities,
  inherited config, effective services, and package locations. Selection,
  dependency ordering, unique-env lookup, and env grouping are derived helpers;
  lookup maps and permanent groups are not public state.

The loader reads env package default JSON exports, validates identity/version,
resolves recursive `extends` through normal dependencies, and caches shared env
loads. Every effective service retains a `source` package location for the env
that declared it. Thus a selected child remains the selected identity while an
inherited compiler or tester resolves relative modules from its parent.
`resolveEnvModuleSpecifier()` consumes a resolved service. The lower-level
`resolveServiceSpecifier()` is pure over a serializable package location,
specifier, and workspace root, so vendors can use it without receiving loader
state or callbacks.

`EnvContext.env` is the single structured identity:
`{ packageName, requestedVersion, installedVersion }`. Workspace groups reuse
the loaded context and canonical components rather than projecting parallel
runtime or component-ref models.

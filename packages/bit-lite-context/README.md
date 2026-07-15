# bit-lite-context

Canonical workspace/component registry and loaded env runtime for Bit-lite.

`bit-lite.json` uses an explicit component array. Each record requires `path`,
`id`, `packageName`, and `env: { packageName, version }`. Legacy top-level
`envs`, `envName`, pattern assignment, defaults, aliases, and overrides are
rejected with migration-focused errors.

`.comp.json` may set `kind` to `component` or `env`; omitted means an ordinary
component. A `workspace:` env ref must name a registered `kind: "env"`
component. Normal versions remain external even when a local component or root
pnpm workspace package has the same name.

The loader reads env package default JSON exports, validates identity/version,
resolves `extends` through normal dependencies, preserves each service's
declaring package/entry origin, and caches by canonical entry plus requested
version. `resolveEnvModuleSpecifier()` uses that origin for relative files and
package subpaths while preventing package-root escape.

Loaded envs retain `packageName`, `requestedVersion`, and `installedVersion`.
Service and worker boundaries project those fields to one closed JSON-safe
`SelectedEnvIdentity`; runtime groups reuse the loaded env instead of copying a
package-name-only identity.

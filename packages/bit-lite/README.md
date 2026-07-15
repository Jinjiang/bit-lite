# bit-lite

Small CLI entrypoint for running bit-lite workspace commands.

## Commands

```sh
bit-lite test --workspace <dir>
bit-lite test --workspace <dir> --filter <component-pattern>
bit-lite test --workspace <dir> --watch
bit-lite compile --workspace <dir>
bit-lite compile --workspace <dir> --filter <component-pattern>
bit-lite install --workspace <dir>
bit-lite install --workspace <dir> --compile
bit-lite preview --workspace <dir>
bit-lite preview --workspace <dir> --filter <component-pattern> --port 4000
```

Every component has an explicit `{ packageName, version }` env reference.
`workspace:` resolves only to a registered `kind: "env"` component; every other
version is installed as that component's logical development dependency. Env
packages default-export a static JSON definition with `test`, `preview`, and/or
`compile` services. Env JSON never owns component file patterns; vendors retain
test/spec discovery.

`bit-lite test` materializes local env components, loads JSON inheritance,
groups components by selected env package, and runs each effective
`services.test` vendor with origin-resolved config.
Use `--filter` to restrict the command input to matching component ids. Exact
component ids and the workspace pattern syntax (`*` and `**`) are supported, and
the flag may be repeated.

Local env components always use Bit-lite's fixed, non-configurable compiler to
copy JSON and transpile adjacent TypeScript support files. Ordinary components
use their own effective `services.compile`; one dependency graph may therefore
contain different compiler vendors or configs.

Run `bit-lite compile` before preview when a component imports a workspace
package owned by another env. Preview aliases only the current env's selected
components to source because other envs may require incompatible loaders or
plugins; cross-env imports continue to resolve through compiled package `dist`
artifacts.

`bit-lite preview` prepares one HTML and one browser entry per selected env,
then starts the configured preview dev-server vendor behind a shared proxy.
Public component links use hash routes under the env base, for example:

```txt
/env/react/#components%2Fui%2Fbutton
/env/react/#components%2Fui%2Fbutton?preview=docs
/env/react/#components%2Fui%2Fbutton?preview=compositions&name=primary%2FMySecondDemo
```

Preview preparation owns docs/demo discovery and literal dynamic imports. A
preview vendor receives server coordinates, the prepared entry/HTML paths, and
the current env's `{ packageName, sourceDir }` alias descriptors; it does not
receive raw components or MDX options in runtime JSON.

The parent-side vendor task retains selected-env and declaring-env origins so
vendors and module-valued config fields resolve from the defining env package.
Worker data is limited to JSON-safe env identity, components, config, CLI args,
and explicit command runtime.

That selected-env identity is
`{ packageName, requestedVersion, installedVersion }` end to end: vendor task
input/results, test result context and storage, compile vendor input, preview
prepared/skipped state, and the preview manifest. Public preview URLs remain
package-name-based; the adjacent manifest preserves both version values.

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

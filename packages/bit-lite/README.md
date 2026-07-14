# bit-lite

Small CLI entrypoint for running bit-lite workspace commands.

## Commands

```sh
bit-lite test --workspace <dir>
bit-lite test --workspace <dir> --filter <component-pattern>
bit-lite test --workspace <dir> --watch
bit-lite preview --workspace <dir>
bit-lite preview --workspace <dir> --filter <component-pattern> --port 4000
```

`bit-lite test` loads the workspace config, groups components by env, and runs
each env's configured `services.test` vendor with that env's config.
Use `--filter` to restrict the command input to matching component ids. Exact
component ids and the workspace pattern syntax (`*` and `**`) are supported, and
the flag may be repeated.

`bit-lite preview` prepares one HTML and one browser entry per selected env,
then starts the configured preview dev-server vendor behind a shared proxy.
Public component links use hash routes under the env base, for example:

```txt
/env/react/#components%2Fui%2Fbutton
/env/react/#components%2Fui%2Fbutton?preview=docs
/env/react/#components%2Fui%2Fbutton?preview=compositions&name=primary%2FMySecondDemo
```

Preview preparation owns docs/demo discovery and literal dynamic imports. A
preview vendor receives only server coordinates plus the prepared entry/HTML
paths; it does not receive raw components or MDX options in runtime JSON.

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

# bit-lite

Small CLI entrypoint for running bit-lite workspace commands.

## Commands

```sh
bit-lite test --workspace <dir>
bit-lite test --workspace <dir> --filter <component-pattern>
bit-lite test --workspace <dir> --watch
```

`bit-lite test` loads the workspace config, groups components by env, and runs
each env's configured `services.test` vendor with that env's config.
Use `--filter` to restrict the command input to matching component ids. Exact
component ids and the workspace pattern syntax (`*` and `**`) are supported, and
the flag may be repeated.

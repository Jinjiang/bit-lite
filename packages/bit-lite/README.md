# bit-lite

Small CLI entrypoint for running bit-lite workspace services.

## Commands

```sh
bit-lite test --workspace <dir>
bit-lite test --workspace <dir> --watch
```

`bit-lite test` loads the workspace config, groups components by env, and runs
each env's configured `test` service vendor with that env's service config.

## Watch Mode Verification

`bit-lite test --watch` is a long-running service and normally stops when the
user quits. For non-interactive checks, set `BIT_LITE_SERVICE_AUTO_STOP_MS` to
stop watch mode automatically after the given number of milliseconds:

```sh
BIT_LITE_SERVICE_AUTO_STOP_MS=100 bit-lite test --workspace <dir> --watch
```

This environment variable is only a test/local verification escape hatch. It is
not workspace service configuration and should not be used by vendors as service
input.

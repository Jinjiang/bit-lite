# bit-lite-compiler

Service-domain contract for Bit-lite compiler vendors.

This package defines compile-specific input/runtime/result types and boundary
validators. Core compile orchestration and compiler vendor implementations both
depend on it. Generic vendor context, runner, message, and task primitives remain
in `bit-lite-vendors`.

A compiler module has the same public shape as other vendor modules: it exports
`meta` and one default `CompilerVendorStart` function. That function reads
`context.args.options.watch`: with watch disabled it compiles once and returns a
`CompileRunResult`; with watch enabled it owns its incremental compiler or
filesystem watcher and returns cleanup. No second named compile entry is
required.

```sh
pnpm --filter bit-lite-compiler typecheck
pnpm --filter bit-lite-compiler build
```

# demo-vendors

Reference vendor implementations for Bit-lite.

The package supplies test, preview, TypeScript compile, and environment compile
vendors. Test vendors
own their hard-coded `*.test.*` / `*.spec.*` discovery rules; env JSON does not
define files or patterns. The compile vendor receives one component at a time
through `{ context, components, config, runtime }`, including the selected
`context.env: { packageName, requestedVersion, installedVersion }` and opaque
effective config. Testers read complete CLI arguments from `context.args`; for
example a vendor-specific `--coverage` option needs no Bit-lite command adapter.
Vendor-specific config modules resolve against `context.service.source`, which
may identify an inherited parent env while `context.env` remains the selected
child.

Compiler implementations consume their service-specific input/result contract
from `bit-lite-compiler`; `bit-lite-vendors` supplies only the generic runtime
and task protocol.

Maintained vendors return produced data only. Test results contain run stats,
component results, and optional coverage; preview results contain readiness;
compile results may contain artifact information or be empty. They do not echo
env, service, vendor, arguments, config, component descriptors, server state, or
output paths. Parent task state supplies that metadata for presentation and
watch-result storage.

Both maintained compiler modules expose the standard `meta` plus default vendor
entry. The default entry reads the common watch flag and either returns a
one-shot compile result or starts the vendor-owned watch lifecycle. Their shared
watch helper lives inside `demo-vendors`, not Bit-lite core: it watches component
source, serializes rebuilds, keeps watching after compilation errors, and closes
the watcher on task shutdown. The env compiler additionally resolves source
`extends`, writes flattened versioned `dist/index.json`, records inherited
service provenance, and emits support modules beside it.

The Vite and Webpack preview adapters consume the command-prepared runtime:

```ts
{
  server: { host, port, basePath, proxyOrigin },
  prepared: { entryFile, htmlFile }
}
```

They load the already-resolved user `configFile`, serve one HTML document and
one logical entry, and preserve proxy-routed HMR. Discovery, hash routing,
rendering, and MDX options are intentionally outside the vendor.

```sh
pnpm --filter demo-vendors test
pnpm --filter demo-vendors typecheck
pnpm --filter demo-vendors build
```

# demo-vendors

Reference vendor implementations for Bit-lite.

The package supplies test, preview, and TypeScript compile vendors. Test vendors
own their hard-coded `*.test.*` / `*.spec.*` discovery rules; env JSON does not
define files or patterns. The compile vendor receives one component at a time
with `env: { packageName, requestedVersion, installedVersion }` and that env's
opaque JSON config. Test and preview vendors copy the same structured identity
from `runtime.data.env` into their service results.

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

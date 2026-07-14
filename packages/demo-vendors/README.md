# demo-vendors

Reference vendor implementations for Bit-lite.

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

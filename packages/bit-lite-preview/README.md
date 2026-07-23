# bit-lite-preview

`bit-lite-preview` contains both sides of the component preview protocol:

- Node.js code discovers preview inputs and prepares a bundler entry.
- Browser code loads docs and compositions and mounts the selected view.
- Proxy code joins multiple environment-specific preview servers under one origin.

## Package entry points

### `bit-lite-preview`

The root entry contains types shared with browser consumers and helpers for the hash-based preview routes:

```ts
import {
  formatCompositionRoute,
  formatDocsRoute,
  formatOverviewRoute,
  parsePreviewHash,
} from "bit-lite-preview";
```

### `bit-lite-preview/node`

The Node.js entry contains preparation and proxy APIs:

```ts
import {
  preparePreviewEnv,
  PreviewProxyServer,
  PreviewProxyState,
  readPreviewPreparedRuntime,
} from "bit-lite-preview/node";
```

`preparePreviewEnv`:

1. discovers `*.docs.md`, `*.docs.mdx`, and `*.demo.*` files;
2. resolves the preview config, mounter, and docs template;
3. creates a generated browser entry and HTML file;
4. returns the runtime information passed to the preview vendor.

`readPreviewPreparedRuntime` validates that runtime inside the vendor.

### `bit-lite-preview/browser`

The browser entry starts the preview application from a component manifest and optional rendering adapters.

## Browser integration types

An env may provide:

- `PreviewMounter`: renders an exported composition into an element and may return cleanup logic;
- `PreviewDocsTemplate`: renders the loaded docs module;
- `PreviewOverviewRenderer`: replaces the default component overview.

The browser runtime returns a `PreviewRuntimeController` with `refresh` and `stop` methods.

## Proxy model

`PreviewProxyState` tracks the components, status, and server information for each resolved env. `PreviewProxyServer` uses that state to expose presentation routes and proxy HTTP/WebSocket traffic to the correct Vite or Webpack server.

Preview servers may start eagerly or on first request, depending on the CLI's `--lazy` option.

## Package development

```bash
pnpm --filter bit-lite-preview build
pnpm --filter bit-lite-preview typecheck
pnpm --filter bit-lite-preview test
```

The build copies the HTML templates in `src/assets` after TypeScript compilation.

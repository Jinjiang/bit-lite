## Why

Preview vendors currently rediscover component files, parse docs, generate bundler entries, route requests, and emit page HTML independently. This makes the Vite and Webpack implementations carry command-level policy, encourages drift between vendors, and leaves no stable browser-rendering layer where shared MDX behavior, layouts, or design-system styles can evolve.

## What Changes

- Move component preview discovery, metadata normalization, config resolution, route metadata, and generated-entry preparation into a command-owned Node API in `bit-lite-preview`, invoked by the `preview` command before vendor tasks start.
- Define a serializable prepared-preview contract so a vendor receives explicit files and one generated browser entry instead of deriving preview inputs from `runtime.data.components`.
- Replace per-component server routes and per-composition Webpack bundles with one HTML document and one browser entry per env; the browser runtime selects the component, preview kind, and composition from `location.hash` and reacts to `hashchange`.
- Generate browser-only component records whose docs and demo entries each carry a statically analyzable `load: () => import(...)` function. `startPreview` consumes these records directly instead of receiving top-level `loadDocs` or `loadComposition` callbacks; the functions exist in generated source and never enter serialized vendor data.
- Add a `demo-utils` package that exports reusable MDX compilation options for Vite and Webpack config files to import directly; these options remain normal build-time JavaScript and are not part of the serialized vendor runtime contract.
- Preserve `docsTemplate` as the runtime interface that receives and renders only the compiled docs module.
- Define three browser surfaces with separate responsibilities: a component overview, docs rendered by the configured or default `docsTemplate`, and a selected demo rendered by the env's `mounter`. The overview is the default route and initially uses a shared demo-list renderer.
- Add an optional `renderOverview` function to the browser-level `startPreview` API. It receives normalized component, docs-link, and demo-link descriptors and can replace the default overview renderer without becoming env config, vendor input, or serialized worker data; generated entries do not supply a custom function yet.
- Keep `mounter`, `docsTemplate`, and `renderOverview` structurally optional in `StartPreviewOptions`. The browser runtime supplies docs and overview defaults, while command-side preparation still requires a mounter when the selected env actually contains demos.
- Keep the default component overview and generated browser entry in a centrally maintained frontend package so a future version can add fixed site-wide CSS, scripts, components, or layout without adding per-vendor configuration.
- Update the proxy manifest and links to point at hash-routed env preview URLs while retaining the proxy as the single public origin.
- **BREAKING**: The preview vendor runtime input changes from raw components plus vendor-owned discovery to prepared preview data, so existing preview vendors must adopt the new contract.
- **BREAKING**: Configured preview URLs move from path-based content routes to the env entry plus a hash route; the existing `docsTemplate` config remains supported.

## Capabilities

### New Capabilities

- `preview-input-preparation`: Command-side discovery, validation, normalized preview manifests, generated entries, and lifecycle cleanup before vendor startup.
- `preview-browser-runtime`: A single env entry and HTML document that dispatches the shared component overview, docs, and selected demos from `location.hash`, using content-local dynamic import functions and live hash navigation.
- `preview-mdx-rendering`: Reusable build-time MDX options in `demo-utils` plus the runtime `docsTemplate` contract that receives only compiled documentation.
- `preview-rendering-extension`: A shared default component-overview renderer, a narrow optional `startPreview.renderOverview` hook, and a reserved site-shell seam that can later gain centrally maintained styles, scripts, components, and layout without vendor-specific configuration.

### Modified Capabilities

None. This repository does not yet have main OpenSpec capability specs for preview.

## Impact

- Affects `packages/bit-lite` preview orchestration, the Node preparation/proxy exports in `packages/bit-lite-preview`, both demo preview vendors, demo preview config modules, and preview tests/documentation; `bit-lite-env` retains the existing `docsTemplate` field.
- Adds `demo-utils` for reusable build-time MDX options and a shared preview preparation/browser-runtime boundary; package installation and lockfile updates must use `pnpm`.
- Removes duplicated discovery, Markdown rendering, route matching, HTML/CSS generation, and Webpack per-composition entry generation from vendor code.
- Requires demo Vite/Webpack configs to consume the shared MDX utility and requires any third-party preview vendor implementing the current runtime shape to adopt prepared inputs.

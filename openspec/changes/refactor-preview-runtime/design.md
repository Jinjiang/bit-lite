## Context

The current `preview` command prepares network runtime fields, but each preview vendor still owns most preview policy. `demo-vendors/src/previewers/core.ts` scans component directories, reads docs, derives titles, parses Markdown, matches content routes, and renders HTML/CSS. The Webpack vendor additionally creates one temporary bundle entry per composition, while the Vite vendor assembles equivalent module scripts in HTML. This makes preview behavior drift across vendors and leaves no single browser entry where site-wide presentation can later be maintained.

The target model follows the useful separation in Bit's current preview implementation:

- Bit's main runtime creates the preview runtime entry and generated link modules before invoking the bundler target ([`preview.main.runtime.ts`](https://github.com/teambit/bit/blob/master/scopes/preview/preview/preview.main.runtime.ts)).
- Its browser runtime reads the component and preview type from `location.hash`, listens for `hashchange`, and dispatches to registered preview definitions ([`preview.preview.runtime.tsx`](https://github.com/teambit/bit/blob/master/scopes/preview/preview/preview.preview.runtime.tsx)).
- Docs file selection and docs rendering are modeled independently of the bundler ([`docs.preview-definition.ts`](https://github.com/teambit/bit/blob/master/scopes/docs/docs/docs.preview-definition.ts)), while MDX support registers with the docs system rather than with one specific preview server ([`mdx.main.runtime.ts`](https://github.com/teambit/bit/blob/master/scopes/mdx/mdx/mdx.main.runtime.ts)).

bit-lite does not need Bit's aspect or artifact machinery, but it can preserve these boundaries with command-owned preparation, a shared browser runtime, build-time MDX configuration, and thin dev-server vendors. Data sent through the existing vendor worker protocol remains JSON-serializable. MDX compiler options do not cross that protocol: they stay as ordinary JavaScript imported by Vite and Webpack config files.

## Goals / Non-Goals

**Goals:**

- Make the `preview` command the owner of file discovery, normalized metadata, generated entry files, and temporary-file lifecycle.
- Give each env vendor one prepared browser entry and one HTML document to serve.
- Route a shared component overview, docs, and selected demos inside the browser from a documented hash grammar.
- Expose a narrow optional `renderOverview` function on `startPreview` while retaining a shared default overview renderer.
- Represent browser docs and demos as component-local records with literal dynamic-import functions instead of top-level loader callbacks.
- Provide reusable MDX compilation options that different Vite and Webpack dev-server configs can import and compose.
- Preserve `docsTemplate` as the runtime contract for rendering compiled documentation.
- Keep one command-owned browser bootstrap where a future fixed frontend package can add site-wide CSS, scripts, components, or layout without vendor configuration.
- Keep the existing proxy, per-env dev servers, HMR, terminal lifecycle, and framework-specific toolchain configs.

**Non-Goals:**

- Reproduce Bit's aspect system, production preview artifacts, split-component bundling, or remote component loading.
- Turn preview vendors into generic build systems or remove their responsibility for starting and stopping a bundler dev server.
- Define the final site design, header, global component library, theme, or layout in this change.
- Define a general-purpose rendering-extension system beyond the narrow overview function, or expose per-env style/layout configuration.
- Serialize MDX plugins or compiler options into `PreviewPreparedRuntime`.
- Discover named compositions inside one demo module; the existing file-level `*.demo.*` model remains.

## Decisions

### 1. The command produces a minimal prepared preview workspace per env

Add command-owned preparation modules alongside `packages/bit-lite/src/commands/preview.ts`. For every selected env, preparation will:

1. Validate the existing preview service config.
2. Discover the selected components' docs and demo files with deterministic ordering.
3. Derive display metadata and stable IDs.
4. Resolve the existing `configFile`, mounter, and `docsTemplate` module specifiers relative to the workspace.
5. Create an env-scoped temporary directory containing one generated browser entry and one HTML file.
6. Return only the paths and server values the vendor needs.

Conceptual vendor contract:

```ts
type PreviewPreparedRuntime = JsonObject & {
  server: {
    host: string;
    port: number;
    basePath: string;
    proxyOrigin: string;
  };
  prepared: {
    entryFile: string;
    htmlFile: string;
  };
};
```

The existing `PreviewServiceConfig.configFile` remains the Vite or Webpack dev-server/toolchain config. Command-side preparation resolves that value in the standard vendor config data; it is not a generated preview artifact and is therefore not duplicated in `PreviewPreparedRuntime.prepared`.

The command retains the normalized JSON component manifest and temp-directory handle for proxy state and cleanup rather than sending them merely because they exist. The generated entry derives browser-only component records from that manifest. Each docs or demo record contains its display descriptors plus a safely encoded, statically analyzable `load: () => import("<resolved-path>")` function. The entry conditionally imports configured `mounter` and `docsTemplate` modules and calls the fixed browser bootstrap. Values inserted into generated source are emitted with JSON stringification rather than raw interpolation.

These `load` functions are generated JavaScript, not worker-protocol data or a DevServer-specific API. Vite preserves each dynamic import as an on-demand browser module request, while Webpack compiles it into an async chunk boundary. Both remain inside one logical entry graph and delay module evaluation until the corresponding route is active.

Vendors neither scan component roots nor create or delete generated preview entries. Preparation failure prevents that env task from starting and is reported with the env and offending config or file. The command owns cleanup for all prepared temp directories.

Alternative considered: put discovery and entry generation in a shared vendor helper. Rejected because these operations define vendor input and must be complete before vendor startup.

### 2. MDX options are a reusable build-time utility

Create a `demo-utils` workspace package with an MDX options export, for example:

```ts
export const mdxOptions = {
  remarkPlugins: [/* plugin functions and options */],
  rehypePlugins: [/* plugin functions and options */],
};
```

The export is ordinary build-time JavaScript. It may contain plugin functions and other values accepted by the MDX compiler and does not need to be JSON-serializable. The package may additionally expose a factory if configs need to derive a local variant without duplicating the shared defaults.

Each Vite or Webpack dev-server config owns its native MDX integration:

```ts
// Vite config
import mdx from "@mdx-js/rollup";
import { mdxOptions } from "demo-utils/mdx-options";

export default defineConfig({
  plugins: [mdx(mdxOptions)],
});
```

```ts
// Webpack config
import { mdxOptions } from "demo-utils/mdx-options";

export default {
  module: {
    rules: [{ test: /\.mdx?$/, use: [{ loader: "@mdx-js/loader", options: mdxOptions }] }],
  },
};
```

The Vite and Webpack preview vendors simply load the resolved `configFile`; they do not inject an MDX adapter, interpret MDX options, or carry plugin descriptors through worker data. Shared behavior comes from configs importing the same utility, while configs remain free to compose or override it when an env genuinely differs.

Alternative considered: define a serializable `PreviewMdxOptions` service field and have vendors rebuild plugins from module descriptors. Rejected because MDX options belong to bundler configuration, function serialization is unnecessary, and the abstraction duplicates the native Vite/Webpack integration points.

### 3. `docsTemplate` receives only the compiled docs module

Keep the existing preview service shape:

```ts
type PreviewServiceConfig = JsonObject & {
  configFile: string;
  mounter?: string;
  docsTemplate?: string;
};
```

`docsTemplate` is an optional module specifier resolved by command-side preparation and conditionally imported by the generated browser entry. It has one responsibility: present the compiled docs module. Component metadata and composition descriptors belong to the shared component overview and are not passed through the docs-specific interface. When the field is absent, the generated entry omits `StartPreviewOptions.docsTemplate` and the browser runtime uses a built-in minimal template.

Conceptual runtime contract:

```ts
type PreviewDocsModule = {
  default: React.ComponentType;
  frontmatter?: Record<string, unknown>;
  [exportName: string]: unknown;
};

type PreviewDocsTemplateProps = {
  docs: PreviewDocsModule;
};

type PreviewDocsTemplate = React.ComponentType<PreviewDocsTemplateProps>;
```

This keeps compilation and rendering separate:

- `demo-utils/mdx-options` and the Vite or Webpack dev-server config determine how Markdown/MDX becomes JavaScript.
- `docsTemplate` determines how that compiled module alone is presented at runtime.
- The overview renderer owns component-level navigation and the demo list.

The command does not add `mdxOptions`, `mdxComponents`, or user-configurable layout fields to `PreviewServiceConfig`.

### 4. Vendors are thin bundler and dev-server adapters

The vendor receives the prepared entry and HTML through preview runtime data, the existing resolved `configFile` through service config data, and the assigned network paths. Its responsibilities are limited to:

- Load the resolved Vite or Webpack `configFile`, including whatever transform plugins or loaders that dev server needs.
- Set the prepared entry as the sole logical bundler entry and serve the prepared HTML at the env base path.
- Configure asset base paths and HMR for the public proxy origin.
- Report readiness and stop the dev server on shutdown.

Webpack changes from an `EntryObject` with one entry per composition to one entry. Vite removes custom docs/composition route middleware and serves the prepared HTML fallback. Bundlers may emit lazy chunks, but there is exactly one logical entry graph and no route-specific entry generation.

Alternative considered: precompile every MDX file in the command. Rejected because emitted modules with relative imports need source-relative bundler resolution, which the existing config files already provide naturally.

### 5. One hash grammar selects three distinct browser surfaces

Each env is served from one document at `/env/<encoded-env-name>/`. The fragment is client-only and follows this grammar:

```txt
#<encoded-component-id>
#<encoded-component-id>?preview=overview
#<encoded-component-id>?preview=docs
#<encoded-component-id>?preview=compositions&name=<encoded-composition-id>
```

The routes map to three renderers with deliberately separate inputs:

- `overview`, including an omitted `preview` parameter, calls the optional `startPreview.renderOverview` function or falls back to the shared default renderer.
- `docs` calls the selected component's `docs.load()` and passes only `{ docs }` to `options.docsTemplate ?? DefaultDocsTemplate`.
- `compositions&name=...` calls the selected demo record's `load()` and passes the resolved module to the optional env `mounter` in an isolated host.

`preview=compositions` without `name` is not a fourth list surface; it is an invalid route. The runtime uses `URLSearchParams`, validates the requested component and composition against the generated browser component records, renders controlled missing-content states, and listens for `hashchange` without reloading the document.

The browser package exports a narrow overview render contract:

```ts
type PreviewOverviewProps = {
  component: PreviewComponentManifest;
  docs?: {
    title?: string;
    route: string;
  };
  compositions: Array<{
    id: string;
    title: string;
    route: string;
  }>;
};

type PreviewOverviewRenderer = (
  props: PreviewOverviewProps
) => React.ReactNode;
```

Every generated entry currently omits the optional function and therefore uses the same default implementation. `renderOverview` is not a preview service option, is not supplied by a vendor, and does not cross the worker protocol; it can only be provided by a browser caller of `startPreview`. The default implementation only displays the demo list. The descriptor-and-route inputs let a future centrally maintained frontend package provide a richer component homepage, including links or iframe-backed docs and demo panels, without widening `DocsTemplate` or `mounter` responsibilities or eagerly loading their modules.

Before every route transition, the runtime invokes the previous composition mounter cleanup before removing or reusing its host. Content-local `load()` functions are lazy so only active docs or demo modules need to execute. A framework-specific mounter exclusively owns its composition host descendants; the browser runtime owns the surrounding document and lifecycle. Command-side preparation still rejects an env that has demos but no configured mounter, while the structurally optional browser field permits docs-only envs and lets the runtime show a controlled missing-mounter state for malformed direct calls.

Proxy manifest links use the public env base URL plus the fragment. Since fragments are never sent in HTTP requests, the proxy forwards only the stable env base path and asset requests.

Alternative considered: retain server path routing and merely share HTML helpers. Rejected because it preserves duplicated route interpretation and prevents a stable, single-entry runtime.

### 6. `startPreview` consumes component-local imports and optional renderers

The shared browser package models generated content separately from the JSON command/proxy manifest:

```ts
type PreviewBrowserDocs = {
  title?: string;
  route: string;
  load: () => Promise<PreviewDocsModule>;
};

type PreviewBrowserComposition = {
  id: string;
  title: string;
  route: string;
  load: () => Promise<PreviewCompositionModule>;
};

type PreviewBrowserComponent = {
  component: PreviewComponentManifest;
  docs?: PreviewBrowserDocs;
  compositions: PreviewBrowserComposition[];
};

type StartPreviewOptions = {
  components: PreviewBrowserComponent[];
  mounter?: PreviewMounter;
  docsTemplate?: PreviewDocsTemplate;
  renderOverview?: PreviewOverviewRenderer;
};
```

All three rendering dependencies are structurally optional. The runtime supplies `DefaultDocsTemplate` and `renderDefaultOverview`; there is no universal fallback mounter because demos may target different UI frameworks. The generated entry supplies configured modules only when present and currently omits `renderOverview`:

```ts
import { startPreview } from "bit-lite-preview/browser";
import mounter from "<resolved-mounter>";
import DocsTemplate from "<resolved-docs-template>";

startPreview({
  components: [
    {
      component: buttonManifest,
      docs: {
        title: "Button",
        route: "#ui/button?preview=docs",
        load: () => import("<resolved-button-docs>"),
      },
      compositions: [
        {
          id: "basic",
          title: "Basic",
          route: "#ui/button?preview=compositions&name=basic",
          load: () => import("<resolved-basic-demo>"),
        },
      ],
    },
  ],
  mounter,
  docsTemplate: DocsTemplate,
});
```

An env without a configured mounter or `docsTemplate` omits those properties. No top-level `loadDocs` or `loadComposition` dispatcher is exposed: after route selection, the runtime finds the component record and invokes exactly the selected docs or demo record's `load()` function.

When an overview route is active, the runtime evaluates `options.renderOverview ?? renderDefaultOverview` and passes the resulting function `PreviewOverviewProps`. Returning `React.ReactNode` keeps React root creation, error handling, route transitions, and HMR lifecycle inside the browser runtime rather than introducing another mounter-style lifecycle contract.

This callback is a narrow browser API, not an env configuration mechanism. There are no env fields such as `globalStyles`, `layout`, `rendering`, or `overviewRenderer`; vendors do not receive related options, and callback functions never enter JSON runtime data.

The package selects the configured overview function or its built-in demo-list fallback for overview routes, the configured docs template or `DefaultDocsTemplate` for docs routes, and the configured mounter for named composition routes. `PreviewOverviewProps` is derived by stripping each content record's `load` function, so overview code receives only stable descriptors and cannot accidentally execute docs or demos. When the site's design is known, a later shared frontend package can pass `renderOverview` and directly import fixed CSS, scripts, Header, Layout, or design-system components. Updating the generated-entry template or shared package version can then enable that presentation without changing individual Vite/Webpack configs or preview vendors.

Only `PreviewOverviewProps` and `PreviewOverviewRenderer` are published for this seam. Component layout contracts remain private until there is a concrete design; this change does not publish `PreviewLayoutProps` or promise arbitrary user-supplied wrappers.

Alternative considered: expose configurable global styles and layout modules now. Rejected because the desired site design is not known, premature configuration becomes a compatibility burden, and central versioned presentation is sufficient for the anticipated use case.

Alternative considered: expose top-level `loadDocs(componentId)` and `loadComposition(componentId, compositionId)` callbacks. Rejected because they duplicate lookup already expressed by the component records and obscure the fact that every lazy boundary is a literal dynamic import generated for one content item. Eager static imports were also rejected because they execute every docs and demo module at startup and weaken code-splitting and route-level HMR boundaries.

### 7. Shared runtime and demo utilities remain separate

Use two different package boundaries because they serve different lifecycles:

- The shared preview runtime package contains JSON-compatible protocol types plus the browser-only component record types, bootstrap, optional renderer contracts, and default renderers used by generated entries. It may later own or import the fixed site presentation.
- `demo-utils` contains build-time utilities such as MDX compiler options that demo Vite and Webpack configs import directly.

Command-side filesystem discovery and temp-file generation stay in `bit-lite`. Preview vendors depend on the shared protocol/runtime package but not on command internals. Browser exports are explicit so bundlers do not pull filesystem or worker code into the browser.

## Risks / Trade-offs

- [A demo dev-server config can stop importing the shared MDX utility and drift] → Cover the supported Vite and Webpack configs with the same MDX fixture and keep the shared import visible in each config.
- [The future site presentation is coupled to the shared browser package version] → Treat that coupling as intentional central maintenance and avoid per-vendor overrides.
- [The narrow overview hook may not cover every future site-shell requirement] → Publish only descriptor-based overview props now and evolve the browser API additively rather than exposing speculative layout or theme contracts.
- [One entry graph can become large as component counts grow] → Generate lazy module loaders so bundlers split inactive docs and demos into chunks while retaining one logical entry.
- [Vite and Webpack transform dynamic imports differently] → Generate only literal import specifiers, test the same browser component fixture through both toolchains, and treat the resolved module promise as the shared runtime contract.
- [Temp paths or source paths can produce invalid generated code] → Resolve paths before generation, serialize every literal, use deterministic filenames, and test spaces, quotes, and cross-platform separators.
- [Different UI frameworks can compete for the same DOM] → Give a composition mounter a dedicated host whose descendants only it owns, and run its cleanup before the browser runtime removes that host.
- [The initial component overview is intentionally sparse] → Keep its inputs as component and route descriptors so the centrally maintained browser package can evolve it without changing env or vendor contracts.
- [Hash URLs change existing bookmarks] → Keep readable links in the proxy manifest and document the grammar rather than maintaining two routing implementations.
- [MDX and config files execute workspace-authored JavaScript] → Treat them as trusted local workspace code, matching existing bundler and tester config execution.

## Migration Plan

1. Add the shared preview runtime/browser package, browser component record types, three optional renderer fields, docs/overview defaults, and the `demo-utils` MDX options export with focused tests.
2. Preserve `docsTemplate` in env config validation and define its docs-only browser runtime contract.
3. Add command-side discovery, module resolution, JSON manifest generation, browser component record generation with content-local dynamic imports, entry generation, and cleanup behind the minimal prepared runtime type.
4. Update demo Vite and Webpack configs to install their native MDX integrations using the same `demo-utils` options.
5. Convert Vite and Webpack vendors to the prepared single-entry contract and remove vendor-owned discovery, routing, rendering, and per-composition entry generation.
6. Add the default component overview and optional overview callback, make overview the default hash surface, change proxy manifest links to hash URLs, and update navigation, HMR, docs-template, mounter, and lifecycle tests.
7. Update preview documentation to distinguish compile-time MDX config, runtime `docsTemplate`, the browser-only overview hook, and the reserved site-shell boundary.

Rollback is a source revert because no persisted user data is migrated.

## Open Questions

None required for this change. The actual global CSS, Header, Layout, design-system components, and their private package implementation are intentionally deferred until the site's design is known.

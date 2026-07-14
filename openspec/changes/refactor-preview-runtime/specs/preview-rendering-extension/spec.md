## ADDED Requirements

### Requirement: The browser runtime provides a default overview renderer
The shared browser package SHALL provide the default overview renderer used when `startPreview` does not receive `renderOverview`. `PreviewServiceConfig` and preview vendors SHALL NOT expose a module override or rendering-extension option for this page.

#### Scenario: Different envs render component overviews
- **WHEN** components from Vite- and Webpack-backed envs use current generated entries and open their overview routes
- **THEN** both use the same centrally maintained default demo-list renderer

#### Scenario: Preview config is validated
- **WHEN** an env declares its preview service
- **THEN** it may retain `configFile`, `mounter`, and `docsTemplate` but does not need `rendering`, `layout`, `globalStyles`, or `mdxComponents` fields

### Requirement: startPreview accepts a narrow overview render function
`startPreview` SHALL accept an optional synchronous `renderOverview` function with the signature `(props: PreviewOverviewProps) => React.ReactNode`. When supplied, it SHALL replace the default overview renderer for overview routes in that browser invocation. The browser runtime SHALL continue owning the React root, error handling, route transitions, and HMR lifecycle.

#### Scenario: A custom function is supplied
- **WHEN** a browser caller starts preview with `renderOverview`
- **THEN** overview routes render the returned React node while docs and named-demo routes retain their specialized renderers

#### Scenario: No custom function is supplied
- **WHEN** a browser caller starts preview without `renderOverview`
- **THEN** overview routes use the shared default renderer

### Requirement: The overview receives component-level descriptors
`PreviewOverviewProps` SHALL contain normalized component metadata, an optional docs descriptor with its route, and demo descriptors with IDs, titles, and routes. The browser runtime SHALL derive those props from `PreviewBrowserComponent` while omitting every content record's `load` function. The default and custom overview renderers SHALL receive descriptors rather than eagerly loaded docs or demo modules.

#### Scenario: Overview renders its initial implementation
- **WHEN** a component with multiple demos opens the default overview route
- **THEN** the page renders a simple demo list from the supplied descriptors and links each item to its named-demo route

#### Scenario: Overview does not eagerly execute content
- **WHEN** a component overview opens
- **THEN** its docs and demo modules remain unloaded until a route or future overview feature explicitly requests them

### Requirement: The overview contract leaves room for a future component homepage
The shared browser package MAY evolve its default overview, or a later centrally maintained frontend package MAY pass `renderOverview` to provide a richer component homepage, while preserving docs and demo route descriptors as navigation boundaries. Such evolution SHALL NOT require each env or vendor to configure a different renderer.

#### Scenario: A future homepage embeds preview content
- **WHEN** a later frontend-package version supplies an overview function with docs or demo panels, including iframe-backed panels
- **THEN** it can derive their URLs from the supplied descriptors without adding content modules to `PreviewDocsTemplateProps` or transferring demo ownership away from the mounter

#### Scenario: The current change is implemented
- **WHEN** this change ships before a final homepage design exists
- **THEN** only the simple demo-list overview is required

### Requirement: Site-wide presentation can be added centrally later
The generated entry SHALL import a fixed browser-safe bootstrap from the shared preview browser package. A later frontend package or generated-entry version MAY directly import fixed CSS, scripts, Header, Layout, or design-system components and pass its overview function to `startPreview`; those additions SHALL apply without preview-vendor changes or per-env rendering configuration.

#### Scenario: A fixed design system is introduced later
- **WHEN** the centrally maintained browser integration imports the approved design-system CSS and passes its overview renderer
- **THEN** generated preview entries gain that presentation by consuming the updated integration version

#### Scenario: Vendor serves a prepared entry
- **WHEN** Vite or Webpack starts an env preview
- **THEN** the vendor serves the command-generated entry without interpreting site styles, layout, or component-page options

### Requirement: Specialized renderers keep separate responsibilities
The shared browser runtime SHALL dispatch overview routes to the configured overview function or its default fallback, docs routes to the configured docs template or its default fallback, and named-demo routes to the optional env mounter. Site-shell evolution MUST NOT widen `PreviewDocsTemplateProps` beyond `{ docs }` or make an overview renderer mount demo modules in place of the mounter.

#### Scenario: Docs route renders
- **WHEN** a component's docs route is active
- **THEN** the selected docs template receives only the compiled docs module and the overview renderer is not responsible for the docs tree

#### Scenario: Named-demo route renders
- **WHEN** a component's named-demo route is active
- **THEN** the env mounter owns the dedicated demo host and the overview renderer is not responsible for mounting the demo

### Requirement: renderOverview is the only public site-shell hook
This change SHALL expose `PreviewOverviewProps`, `PreviewOverviewRenderer`, and the optional `startPreview.renderOverview` field as the narrow browser-level site-shell hook. The existing docs template and mounter remain content-specific renderers. Other site-shell and layout implementation contracts SHALL stay internal, and this change SHALL NOT promise arbitrary user-supplied wrappers, ordered global-style imports, env configuration, or vendor-specific presentation hooks.

#### Scenario: No final site design exists
- **WHEN** the initial browser package is published
- **THEN** it exposes the overview render contract but keeps future layout and theme details private

#### Scenario: Custom presentation is added later
- **WHEN** a later browser integration supplies `renderOverview` or adds a fixed layout around the runtime
- **THEN** env configs and vendor runtime payloads remain unchanged

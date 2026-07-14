## ADDED Requirements

### Requirement: Each env uses one document and one logical entry
Each prepared env SHALL expose one HTML document and one logical browser entry graph for every component overview, docs page, and demo. A dev-server toolchain MAY emit lazy chunks, but it MUST NOT create a separate entry or HTML document for each component, route, or demo.

#### Scenario: Webpack env has multiple demos
- **WHEN** a Webpack preview env contains demos from multiple components
- **THEN** its dev-server compiler receives one logical entry and compiles each demo record's literal dynamic import as an async chunk boundary

#### Scenario: Vite env serves all preview surfaces
- **WHEN** a Vite preview env serves component overviews, docs, and individual demos
- **THEN** every surface is rendered from the same prepared HTML and browser entry while active content is requested through its record's dynamic import

### Requirement: Hash routes select exactly three preview surfaces
The browser runtime SHALL recognize `#<component-id>` and `#<component-id>?preview=overview` as the component overview, `#<component-id>?preview=docs` as docs, and `#<component-id>?preview=compositions&name=<demo-id>` as one selected demo. Component and demo identifiers SHALL be percent-encoded in generated URLs and decoded exactly once by the runtime.

#### Scenario: Preview parameter is absent
- **WHEN** the document loads with a known component ID and no `preview` parameter
- **THEN** the runtime renders the component overview

#### Scenario: Hash explicitly selects overview
- **WHEN** the document loads with `preview=overview` for a known component
- **THEN** the runtime renders the same component overview as the default route

#### Scenario: Hash selects docs
- **WHEN** the document loads with `preview=docs` for a known component
- **THEN** the runtime renders that component's docs surface

#### Scenario: Hash selects a demo
- **WHEN** the document loads with `preview=compositions` and a valid `name`
- **THEN** the runtime renders the named demo for that component

### Requirement: Every env has a shared default overview renderer
The browser package SHALL provide one default overview renderer and `startPreview` SHALL accept an optional `renderOverview` function that replaces it for that browser invocation. Both renderers SHALL receive normalized component metadata, an optional docs descriptor with its route, and demo descriptors with their file-level IDs and routes. The runtime SHALL strip content-local `load` functions from these props. The function SHALL NOT be configurable through `PreviewServiceConfig`, supplied by a vendor, or included in serialized runtime data.

#### Scenario: Generated entry omits the optional renderer
- **WHEN** the current command-generated entry calls `startPreview` without `renderOverview`
- **THEN** the shared default renderer displays a demo list whose links target the corresponding named-demo hash routes

#### Scenario: Browser caller supplies a custom renderer
- **WHEN** `startPreview` receives a `renderOverview` function and an overview route becomes active
- **THEN** the runtime calls that function with the component, docs-link, and demo-link descriptors instead of calling the default renderer

#### Scenario: Component has docs and no demos
- **WHEN** the selected overview renderer runs for a component with docs but no demos
- **THEN** it receives the docs descriptor and an empty demo array and can render a controlled overview state

### Requirement: startPreview rendering dependencies are structurally optional
`StartPreviewOptions` SHALL declare `mounter`, `docsTemplate`, and `renderOverview` as optional fields. The browser runtime SHALL provide default docs and overview renderers. A mounter SHALL only be invoked for a selected demo, and a missing mounter SHALL produce a controlled runtime error if an invalid direct browser invocation bypasses command-side validation.

#### Scenario: Browser starts with only component records
- **WHEN** `startPreview` receives `components` without any of the three optional rendering fields
- **THEN** overview and available docs routes use the built-in renderers without failing startup

#### Scenario: Demo route lacks a mounter
- **WHEN** a direct `startPreview` call includes a demo record but omits `mounter` and selects that demo route
- **THEN** the runtime renders a controlled missing-mounter error instead of throwing an uncaught exception

### Requirement: DocsTemplate receives only docs
For a docs route, the browser runtime SHALL call the selected component's `docs.load()`, choose `options.docsTemplate ?? DefaultDocsTemplate`, and pass the compiled module to that template as `{ docs }`. The runtime MUST NOT pass component metadata, demo descriptors, or the `load` function through `PreviewDocsTemplateProps`.

#### Scenario: Configured DocsTemplate renders docs
- **WHEN** a known component with docs is opened with `preview=docs`
- **THEN** the runtime invokes that component's docs `load()` and supplies the resolved module as the sole data property of the configured `docsTemplate`

#### Scenario: DocsTemplate is not configured
- **WHEN** a known component with docs is opened and the env omits `docsTemplate`
- **THEN** the built-in minimal docs template renders the module returned by `docs.load()` with the same docs-only contract

### Requirement: The mounter owns selected demo rendering
For a named-demo route, the browser runtime SHALL call only the selected demo record's `load()`, create a dedicated host, and pass the resolved module and host to the optional env mounter. The overview renderer and docs template MUST NOT render the demo module themselves.

#### Scenario: Demo route is active
- **WHEN** a valid named-demo route is selected
- **THEN** the mounter exclusively owns the descendants of the dedicated demo host until its cleanup completes

#### Scenario: Runtime leaves a demo route
- **WHEN** navigation, HMR, or shutdown disposes an active demo
- **THEN** the mounter cleanup completes before the browser runtime removes or reuses its host

### Requirement: Hash navigation rerenders without document reload
The browser runtime SHALL listen for `hashchange`, dispose the previous surface, and render the next valid route without requesting a different HTML document.

#### Scenario: User navigates between demos
- **WHEN** the hash changes from one valid named-demo route to another
- **THEN** the previous mounter cleanup runs before the new demo is mounted and the document is not reloaded

#### Scenario: User navigates from a demo to docs
- **WHEN** the hash changes from a named-demo route to a docs route
- **THEN** the demo is cleaned up and the docs module is rendered through `DocsTemplate` in the shared document

### Requirement: Invalid routes render controlled states
The browser runtime SHALL render a controlled empty or not-found surface for unknown components, unknown preview values, missing docs, a `compositions` route without `name`, and unknown demos. These cases MUST NOT crash the dev server.

#### Scenario: Unknown component is requested
- **WHEN** a hash contains a component ID absent from the prepared manifest
- **THEN** the runtime renders a not-found surface that includes the requested component ID

#### Scenario: Demo name is absent
- **WHEN** a known component is opened with `preview=compositions` and no `name`
- **THEN** the runtime renders an invalid-route state rather than treating it as a separate demo-list surface

#### Scenario: Component has no docs
- **WHEN** a known component without a docs file is opened with `preview=docs`
- **THEN** the runtime renders the shared empty-docs surface

### Requirement: Proxy links target the hash runtime
The proxy manifest SHALL generate overview, docs, and named-demo links from the public env base URL plus the documented hash routes. HTTP and WebSocket proxying SHALL continue to use only the env base path and asset paths because URL fragments are client-only.

#### Scenario: Manifest is requested after env preparation
- **WHEN** the proxy returns a component entry
- **THEN** its primary URL targets the default component hash and its docs and demo links use the proxy origin, encoded env base path, encoded component hash, and appropriate preview query

#### Scenario: Browser requests a hash link
- **WHEN** a user opens a manifest hash link
- **THEN** the server receives the stable env document path and the browser runtime receives the fragment

### Requirement: Active preview modules support development updates
The generated entry SHALL attach a literal dynamic-import `load()` function to each prepared docs and demo record, and a supported vendor SHALL connect module updates to rerendering the active hash route without generating a new entry file. It SHALL NOT require top-level `loadDocs` or `loadComposition` callbacks.

#### Scenario: Active docs file changes under Vite or Webpack
- **WHEN** the dev-server toolchain reports an accepted update for the active docs module
- **THEN** the runtime reloads that module and rerenders the current docs route

#### Scenario: Inactive demo exists
- **WHEN** the env starts on an overview or docs route
- **THEN** inactive demo modules are not required to execute before the initial surface renders

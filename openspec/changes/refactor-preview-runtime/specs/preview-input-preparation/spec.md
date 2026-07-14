## ADDED Requirements

### Requirement: Preview inputs are prepared before vendor startup
The `preview` command SHALL discover, normalize, and generate every selected env's preview inputs before starting that env's vendor task. A preview vendor SHALL consume the prepared files and SHALL NOT rediscover docs or demo files from raw component directories.

#### Scenario: Selected env has preview content
- **WHEN** the command selects components for an env with `services.preview`
- **THEN** it prepares that env's component manifest, generated browser entry, HTML file, resolved service config, and server runtime before starting the vendor task

#### Scenario: Vendor consumes prepared files
- **WHEN** a preview vendor starts successfully
- **THEN** it receives explicit prepared entry and HTML paths and does not scan `runtime.data.components` for preview files

### Requirement: Discovery is deterministic and command-owned
The command SHALL inspect only the selected components, SHALL sort component and file inputs deterministically, SHALL select the first sorted `.docs.md` or `.docs.mdx` file per component, and SHALL statically discover every runtime value export from every sorted `*.demo.*` file without importing or evaluating those modules in Node. It SHALL recognize default exports, named exported declarations, and explicit export lists, SHALL exclude type-only exports, and SHALL preserve deterministic source declaration order within each file.

#### Scenario: Component has multiple matching files
- **WHEN** a selected component contains multiple docs files and multiple demo files
- **THEN** the prepared manifest contains the first sorted docs file and every runtime export from all demo files in stable file and source declaration order

#### Scenario: Demo file contains default and named exports
- **WHEN** `primary.demo.ts` exports `default` and `MySecondDemo`
- **THEN** preparation creates two demos without evaluating the module or its framework imports

#### Scenario: Demo file contains type-only exports
- **WHEN** a TypeScript demo file exports interfaces or types alongside runtime values
- **THEN** only the runtime value exports become demos

#### Scenario: Demo file contains an unresolved star export
- **WHEN** a demo file contains `export * from "./other.js"`
- **THEN** preparation fails with the demo file and unsupported export form instead of producing an incomplete manifest

#### Scenario: Component has no preview files
- **WHEN** a selected component has neither a docs file nor a demo file
- **THEN** the component remains in the manifest with absent docs and an empty compositions array so its overview route remains addressable

### Requirement: Demo exports have composite IDs and derived names
Each discovered demo export SHALL have `exportName`, derived `name`, and a stable composite `id` formatted as `<demo-file-id>/<export-name>`. The demo file ID SHALL be the filename portion before `.demo.<extension>`. The `default` export SHALL be supported with export name `default` and display name `Default`, although maintained examples and documentation SHALL discourage default demo exports. Named exports SHALL derive readable names by splitting identifier separators, lower-or-digit to upper-case boundaries, and acronym-to-word boundaries, then capitalizing the first word when necessary. Authors SHALL NOT provide a separate demo title.

#### Scenario: Named export uses PascalCase
- **WHEN** `primary.demo.ts` exports `MySecondDemo`
- **THEN** its descriptor has ID `primary/MySecondDemo`, export name `MySecondDemo`, and name `My Second Demo`

#### Scenario: Demo file uses a default export
- **WHEN** `primary.demo.ts` has a default export
- **THEN** its descriptor has ID `primary/default`, export name `default`, and name `Default`

#### Scenario: Separate files reuse an export name
- **WHEN** `primary.demo.ts` and `secondary.demo.ts` both export `DefaultState`
- **THEN** their IDs are `primary/DefaultState` and `secondary/DefaultState` and do not collide

#### Scenario: Named export contains an acronym
- **WHEN** a demo file exports `XMLCard`
- **THEN** its derived name is `XML Card`

### Requirement: Vendor runtime data is minimal and serializable
The command SHALL pass a JSON-serializable `PreviewPreparedRuntime` containing only server coordinates and the prepared entry and HTML paths required by the vendor. The command SHALL retain the normalized component manifest and temp-directory lifecycle state, and the existing preview service config SHALL carry the resolved dev-server `configFile`. Loaded modules, callbacks, MDX options, plugin functions, and raw component inputs MUST NOT cross the vendor worker boundary.

#### Scenario: Worker task is created
- **WHEN** the command converts a prepared env into `VendorTaskStartOptions`
- **THEN** `runtime.data.server` contains `host`, `port`, `basePath`, and `proxyOrigin`, while `runtime.data.prepared` contains only `entryFile` and `htmlFile`

#### Scenario: Generated source references runtime modules
- **WHEN** the generated entry references a docs, demo, mounter, or `docsTemplate` module
- **THEN** it uses the command-resolved module path encoded as a safe JavaScript string literal

### Requirement: Generated browser records own their lazy imports
The command SHALL generate a browser-only `PreviewBrowserComponent` array separately from the JSON manifest. Each docs record SHALL contain its own literal `load: () => import("<resolved-path>")` function. Each export-level demo record SHALL contain a literal dynamic import of its containing file followed by selection of `module[exportName]`, so its `load()` resolves the selected export value rather than the module namespace. The generated entry MUST NOT expose top-level `loadDocs` or `loadComposition` dispatch callbacks.

#### Scenario: Component has docs and demos
- **WHEN** the command generates that component's browser record
- **THEN** its docs record and every export-level demo record contain literal dynamic imports that the dev-server toolchain can analyze

#### Scenario: One demo file has multiple exports
- **WHEN** a file contributes `default` and `MySecondDemo` records
- **THEN** both records import the same literal file path but resolve `module["default"]` and `module["MySecondDemo"]` respectively

#### Scenario: Generated entry crosses the vendor boundary
- **WHEN** the command starts the vendor with the prepared entry path
- **THEN** the vendor receives only the path to the generated source and no browser `load` function is placed in JSON runtime data

### Requirement: Existing preview service modules are resolved centrally
The command SHALL resolve the existing `configFile`, optional `mounter`, and optional `docsTemplate` specifiers relative to the workspace and SHALL validate their existence before vendor startup. `configFile` SHALL continue to identify the env's Vite or Webpack dev-server/toolchain config. A mounter SHALL be required only when the selected env manifest contains at least one demo.

#### Scenario: Docs-only env omits a mounter
- **WHEN** an env's selected components contain docs but no demos and `mounter` is absent
- **THEN** preparation succeeds and the generated entry can render docs through the configured or built-in `DocsTemplate`

#### Scenario: Demo env omits a mounter
- **WHEN** an env's selected components contain at least one demo and `mounter` is absent
- **THEN** preparation fails with an error that identifies the env and missing field and the vendor task is not started

#### Scenario: Configured service module cannot be resolved
- **WHEN** `configFile`, `mounter`, or `docsTemplate` cannot be resolved from the workspace
- **THEN** preparation fails before vendor startup with the env, config field, and module specifier in the error

### Requirement: Preparation failures are isolated and visible
If preparation fails for one env, the command SHALL mark that env as failed with a useful reason and SHALL continue starting other independently prepared envs. If no env can start, the command SHALL close the proxy and terminate without leaking resources.

#### Scenario: One of multiple envs cannot be prepared
- **WHEN** two envs are selected and preparation fails for only one
- **THEN** the valid env's vendor starts and the proxy manifest reports the failed env and reason

#### Scenario: Every env fails preparation
- **WHEN** all selected preview envs fail preparation
- **THEN** no vendor starts, the proxy is closed, and the command reports the failures

### Requirement: The command owns prepared-file cleanup
The command SHALL delete every env-scoped prepared temp directory during normal shutdown and startup failure. Vendor shutdown SHALL NOT be responsible for deleting command-prepared files.

#### Scenario: User stops a running preview
- **WHEN** the preview command receives its normal quit or signal shutdown
- **THEN** it stops vendors and removes all prepared temp directories

#### Scenario: Vendor startup throws
- **WHEN** preparation succeeds but vendor startup fails
- **THEN** the command removes the prepared temp directory during failure cleanup

## Purpose

Define command-owned preview discovery, generated inputs, vendor runtime data, workspace aliases, module resolution, failure isolation, and cleanup.

## Requirements

### Requirement: Preview inputs are prepared before vendor startup
The `preview` command SHALL discover, normalize, and generate every selected env's preview inputs before starting that env's vendor task. A preview vendor SHALL consume the prepared files and SHALL NOT rediscover docs or demo files from raw component directories.

#### Scenario: Selected env has preview content
- **WHEN** the command selects components for an env with `services.preview`
- **THEN** it prepares that env's component manifest, generated browser entry, HTML file, resolved service config, server runtime, workspace root, and selected-component alias descriptors before starting the vendor task

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
The command SHALL pass a JSON-serializable `PreviewPreparedRuntime` containing server coordinates, the prepared entry and HTML paths, the workspace root, and a minimal alias descriptor for every selected component in that env. Each descriptor SHALL contain only the component package name and its command-resolved absolute source directory. The command SHALL retain the normalized preview component manifest and temp-directory lifecycle state, and the existing preview service config SHALL carry the resolved dev-server `configFile`. Loaded modules, callbacks, MDX options, plugin functions, raw `ComponentRef` values, docs/demo manifests, env configuration, and rendering metadata MUST NOT cross the vendor worker boundary.

#### Scenario: Worker task is created
- **WHEN** the command converts a prepared env into `VendorTaskStartOptions`
- **THEN** `runtime.data.server` contains `host`, `port`, `basePath`, and `proxyOrigin`, `runtime.data.prepared` contains only `entryFile` and `htmlFile`, and `runtime.data.workspace` contains `rootDir` plus selected `{ packageName, sourceDir }` descriptors

#### Scenario: Different envs select different components
- **WHEN** the command prepares separate vendor tasks for two envs
- **THEN** each task's workspace descriptor contains only the components selected for that env rather than the complete workspace component catalog

#### Scenario: Generated source references runtime modules
- **WHEN** the generated entry references a docs, demo, mounter, or `docsTemplate` module
- **THEN** it uses the command-resolved module path encoded as a safe JavaScript string literal

### Requirement: Vendors apply workspace component aliases natively
Each preview vendor SHALL translate the supplied workspace component descriptors into its dev server toolchain's native package-alias configuration. The generated alias SHALL match the workspace package name and resolve it to the supplied source directory. A generated workspace alias SHALL take precedence over a user-configured alias for the same package, while aliases for unrelated names SHALL remain unchanged. Vendors SHALL NOT read `bit-lite.json` or rediscover component paths to construct these aliases.

The command SHALL limit source aliases to components selected for the current env so every aliased source file is processed by a compatible preview vendor and config. A workspace component imported from another env SHALL continue through normal package resolution and therefore requires its compiled package artifact to exist before preview starts. Implementations MAY later share aliases across envs only when they can prove that the preview vendor and resolved config are identical.

#### Scenario: Vite vendor starts a workspace env
- **WHEN** the Vite preview vendor receives a selected component descriptor
- **THEN** it merges an equivalent Vite `resolve.alias` entry into the loaded config before creating the dev server

#### Scenario: Webpack vendor starts a workspace env
- **WHEN** the Webpack preview vendor receives a selected component descriptor
- **THEN** it merges an exact-package Webpack `resolve.alias` entry into the loaded config before creating the compiler

#### Scenario: User config already defines unrelated aliases
- **WHEN** a loaded dev-server config contains aliases whose names do not match selected workspace packages
- **THEN** the vendor preserves those aliases alongside the generated workspace aliases

#### Scenario: User config aliases a selected workspace package elsewhere
- **WHEN** a loaded dev-server config defines an alias for the same package name as a selected workspace component
- **THEN** the command-supplied source directory wins so preview imports consistently address the selected local component

#### Scenario: Maintained demo config is loaded
- **WHEN** a maintained Vite or Webpack config is evaluated for preview
- **THEN** it does not read workspace configuration or import a workspace-component-alias helper

#### Scenario: Selected component imports a component from another env
- **WHEN** a source-aliased component imports a workspace package owned by an env with a different preview transform configuration
- **THEN** the vendor does not alias that foreign source and normal package resolution consumes the artifact produced by `bit-lite compile`

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

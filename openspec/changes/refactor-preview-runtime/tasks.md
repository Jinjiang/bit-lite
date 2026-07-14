## 1. Shared Preview Contracts and Packages

- [x] 1.1 Scaffold the shared preview runtime/browser package with explicit Node, browser, and type exports for the minimal prepared runtime, JSON component manifests, `PreviewBrowserComponent` content records, hash routes, `PreviewDocsTemplate`, mounters, `PreviewOverviewProps`, `PreviewOverviewRenderer`, and `StartPreviewOptions` with all three renderer fields optional.
- [x] 1.2 Scaffold the `demo-utils` workspace package and export reusable MDX compiler options, with an optional factory for composing local config variants.
- [x] 1.3 Preserve and validate the existing `PreviewServiceConfig` fields `configFile`, optional `mounter`, and optional `docsTemplate`; add tests for valid, missing, and unresolvable service modules.
- [x] 1.4 Add the React, MDX, Vite, and Webpack integration dependencies to the appropriate workspace packages and update the lockfile using `pnpm`.

## 2. Command-Side Preview Preparation

- [x] 2.1 Move deterministic docs/demo-file discovery and metadata derivation into command-owned preview preparation APIs exported from `bit-lite-preview/node`, preserving selected-component scope and demo-file identity for normalized records.
- [x] 2.2 Resolve `configFile`, `mounter`, and `docsTemplate` relative to the workspace before vendor startup, requiring a mounter only when the selected env has demos.
- [x] 2.3 Generate one env-scoped HTML file and one safe JavaScript entry containing `PreviewBrowserComponent[]`; attach a literal `load: () => import("<resolved-path>")` to each docs/demo record, conditionally include configured `mounter` and `docsTemplate` imports, omit `renderOverview`, and expose no top-level loader callbacks.
- [x] 2.4 Build JSON-only `PreviewPreparedRuntime` payloads containing server coordinates plus `prepared.entryFile` and `prepared.htmlFile`, and stop passing raw components, manifests, config files, or MDX options through vendor runtime data.
- [x] 2.5 Add per-env preparation failure handling to proxy state while allowing valid envs to start, including the all-failed shutdown path.
- [x] 2.6 Add command-owned temp-directory cleanup for normal shutdown, preparation failure, and vendor startup failure.
- [x] 2.7 Add preparation tests for deterministic discovery, safe generated source, content-local literal imports, absence of top-level loader callbacks, optional renderer fields, config resolution, conditional mounter validation, minimal JSON serialization, partial failures, and cleanup.

## 3. Shared Browser Runtime and Three Surfaces

- [x] 3.1 Implement and test hash parsing/formatting for default and explicit overview routes, docs routes, named-demo routes, percent encoding, and invalid `compositions` routes without a name.
- [x] 3.2 Implement `StartPreviewOptions` with optional `mounter`, `docsTemplate`, and synchronous `renderOverview`; add the shared default demo-list overview and pass overview renderers descriptor-only props with every content `load` function removed.
- [x] 3.3 Implement docs-route loading through the selected component record's `docs.load()` so `options.docsTemplate ?? DefaultDocsTemplate` receives only `{ docs }`, with controlled missing-docs and loader-error states.
- [x] 3.4 Implement named-demo loading through the selected record's `load()` with a dedicated host and optional env mounter, including a controlled missing-mounter state and cleanup before navigation, HMR replacement, host reuse, or shutdown.
- [x] 3.5 Listen for `hashchange` and accepted module updates to rerender the active overview, docs, or named-demo route without reloading the HTML document or generating a new entry.
- [x] 3.6 Add browser-runtime tests for starting with all three renderer fields omitted, default overview and docs fallbacks, a supplied custom overview function and descriptor-only props, content-local lazy module execution, missing mounter, invalid routes, cross-framework host ownership, cleanup ordering, and HMR rerendering.

## 4. Shared MDX Options and Docs Compilation

- [x] 4.1 Implement the `demo-utils` MDX options export with the agreed shared remark/rehype behavior as ordinary JavaScript that may contain plugin functions.
- [x] 4.2 Update the maintained Vite dev-server config to import the shared options and apply them through its native MDX plugin.
- [x] 4.3 Update the maintained Webpack dev-server config to import the shared options and apply them through its native MDX loader.
- [x] 4.4 Add a shared docs fixture covering frontmatter, Markdown, JSX, and a shared remark or rehype transformation, plus minimal and custom `DocsTemplate` fixtures using the docs-only contract.
- [x] 4.5 Test compilation and `DocsTemplate` rendering parity through the maintained Vite and Webpack configs, including explicit failures from missing integrations or throwing plugins.

## 5. Thin Preview Vendor Adapters

- [x] 5.1 Refactor the Vite preview vendor to load the resolved user `configFile`, serve the prepared HTML and sole logical entry, and configure proxy-aware HMR without discovery, routes, rendering, or MDX injection.
- [x] 5.2 Refactor the Webpack preview vendor to load the resolved user `configFile`, compile one prepared logical entry with proxy-aware public paths, and remove per-demo temporary bundles and MDX injection.
- [x] 5.3 Preserve vendor readiness, result, error, and shutdown behavior; add tests that each adapter closes its dev server and reports config/build failures with env and vendor context.
- [x] 5.4 Delete vendor-owned discovery, Markdown parsing, route matching, HTML/CSS rendering, and generated-entry helpers after both adapters consume the prepared contract.

## 6. Proxy, Demo, and Integration Migration

- [x] 6.1 Change proxy component manifests and shell links to use the public env base plus default overview, docs, and named-demo hash routes while keeping HTTP asset and WebSocket forwarding scoped to the env base path.
- [x] 6.2 Update demo workspace Vite and Webpack configs to import `demo-utils` MDX options while retaining their `mounter` and `docsTemplate` runtime configuration.
- [x] 6.3 Expand demo fixtures to exercise the shared overview and docs behavior while preserving representative React, Vue, and static demo mounters.
- [x] 6.4 Update command and proxy tests for hash manifests, default overview links, loading/failed env states, partial preparation success, and resource cleanup.
- [x] 6.5 Add end-to-end coverage proving Vite and Webpack serve one document and logical entry, transform content-local dynamic imports correctly, navigate among the three surfaces by hash, and retain HMR through the proxy.

## 7. Documentation and Verification

- [x] 7.1 Rewrite `docs/preview-command-design.md` to distinguish command-owned JSON preparation, generated browser component records with content-local imports, the minimal vendor contract, the three hash surfaces, all-optional renderer inputs, build-time MDX options, runtime docs templates, the narrow browser-only `renderOverview` hook, and the otherwise private future site-shell boundary.
- [x] 7.2 Update package READMEs and example config snippets with `pnpm` commands and migration guidance for prepared vendor inputs and path-to-hash preview URLs, explicitly documenting that `docsTemplate` remains supported.
- [x] 7.3 Run targeted package tests, the full `pnpm` test suite, typechecks, and builds; resolve failures and record any intentionally deferred homepage or site-design work.

## 8. Review Follow-up

- [x] 8.1 Restore per-component demo-workspace configuration and keep its root package manifest limited to `bit-lite`; component dependencies remain owned by `bit-lite install`.
- [x] 8.2 Remove composition `title` from prepared, proxy, and browser contracts and stop exporting demo titles from fixtures.
- [x] 8.3 Move reusable preparation and proxy implementations into `bit-lite-preview/node` without introducing package cycles.
- [x] 8.4 Replace production inline HTML documents with package asset files that are copied into built output.
- [x] 8.5 Simplify the resolved config-file guard and document the Vite-specific prepared-entry transform bridge.
- [x] 8.6 Update tests, documentation, lockfile, and verify the affected packages plus the full workspace.

## 9. Export-Level Demo Follow-up

- [x] 9.1 Extend prepared, proxy, overview, and browser composition contracts with composite `id`, original `exportName`, derived `name`, and a selected export value loader; add the syntax-aware JavaScript/TypeScript parser dependency with `pnpm`.
- [x] 9.2 Replace one-file-one-demo discovery with deterministic runtime export discovery that excludes type-only exports, rejects unresolved `export *`, derives `<file-id>/<export-name>` IDs, and implements the agreed `Default`, camel/Pascal case, separator, digit, and acronym name conversion rules.
- [x] 9.3 Generate one lazy record per demo export using a literal import followed by `module[exportName]`; update hash routing and the browser runtime to select the composite ID and pass the resolved export value directly to the mounter without default-export unwrapping.
- [x] 9.4 Update default/custom overview props, proxy manifests, shell links, loading states, and controlled errors to expose and display derived demo names while retaining encoded composite routes.
- [x] 9.5 Update maintained demo fixtures so at least one file exports both a discouraged default demo and a named demo such as `MySecondDemo`, while other maintained examples prefer named exports.
- [x] 9.6 Add preparation, naming, route, browser lifecycle, proxy, Vite, Webpack, HMR, same-file chunk, duplicate-cross-file export-name, type-only export, and unsupported star-export coverage for export-level demos.
- [x] 9.7 Update preview documentation and package READMEs with export-level authoring and restart semantics, update the lockfile with `pnpm`, then run targeted tests, the full workspace tests, typechecks, builds, and strict OpenSpec validation.

## 10. Runtime Verification Follow-up

- [x] 10.1 Make workspace loading honor the restored per-component config array, preserve explicit component IDs, and bridge each record to its local service env with `envName`.
- [x] 10.2 Extend `PreviewPreparedRuntime` and command-side preparation with the workspace root plus selected `{ packageName, sourceDir }` alias descriptors, keeping raw component and preview-manifest data out of the vendor worker payload.
- [x] 10.3 Make the Vite and Webpack preview vendors merge command-supplied workspace aliases through their native config shapes, give generated exact-package aliases precedence, preserve unrelated user aliases, and cover both adapters with focused tests.
- [x] 10.4 Remove the demo-config `workspace-component-aliases` helper and config imports, document that cross-env package imports require `bit-lite compile`, then run targeted tests, typechecks, builds, strict OpenSpec validation, and the real compiled demo-workspace preview command.
- [x] 10.5 Fix browser regressions by making the prepared module-script URL base-relative, scanning the prepared Vite entry, ensuring maintained env configs resolve and deduplicate framework runtimes across source-aliased components, preserving self-rendered static demos, stopping manifest polling after startup reaches terminal states, adding regression coverage, and verifying every demo-workspace preview surface in a real browser.
- [x] 10.6 Isolate each Vite preview env's dependency-optimizer cache under the workspace `.bit-lite` directory, move E2E temp workspaces under `demo-workspace/.bit-lite` with setup-wide cleanup, remove leaked root temp directories, and verify concurrent Vite envs in a real browser.

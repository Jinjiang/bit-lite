## MODIFIED Requirements

### Requirement: Preview inputs are prepared before vendor startup
The `preview` command SHALL discover, normalize, and generate every selected env's preview inputs before activating that env's vendor execution. It MAY create a stable idle logical task after successful preparation, but a preview worker or vendor entry MUST NOT start before the prepared files, resolved modules, component manifest, alias descriptors, and server binding/routing hints exist. A preview vendor SHALL consume the prepared files and SHALL NOT rediscover docs or demo files from raw component directories.

#### Scenario: Selected env has preview content
- **WHEN** the command selects components for an env with `services.preview`
- **THEN** it prepares that env's component manifest, generated browser entry, HTML file, resolved service config, server binding/routing hints, workspace context, and selected-component alias descriptors before activating vendor execution

#### Scenario: Lazy logical task is created
- **WHEN** preparation succeeds while `--lazy` is enabled
- **THEN** the command may return an idle logical task for supervision but does not create its worker or start its vendor

#### Scenario: Vendor consumes prepared files
- **WHEN** a preview vendor activates successfully
- **THEN** it receives explicit prepared entry and HTML paths and does not scan `runtime.data.components` for preview files

### Requirement: Vendor runtime data is minimal and serializable
The command SHALL pass a JSON-serializable `PreviewPreparedRuntime` containing parent-owned server binding/routing hints, the prepared entry and HTML paths, and a minimal alias descriptor for every selected component in that env. The server hints SHALL contain `host`, `preferredPort`, `fallbackStartPort`, `basePath`, and `proxyOrigin`, and SHALL NOT claim a final bound port. Each alias descriptor SHALL contain only the component package name and its command-resolved absolute source directory. The command SHALL retain the normalized preview component manifest and temp-directory lifecycle state, `VendorContext.workspace` SHALL retain the workspace root and canonical components, and the existing preview service config SHALL carry the resolved dev-server `configFile`. Loaded modules, callbacks, MDX options, plugin functions, raw component references, docs/demo manifests, env configuration, and rendering metadata MUST NOT cross the vendor worker boundary.

#### Scenario: Worker task data is prepared
- **WHEN** the command converts a prepared env into deferred or eager vendor task data
- **THEN** `runtime.server` contains `host`, `preferredPort`, `fallbackStartPort`, `basePath`, and `proxyOrigin` without an actual port, `runtime.prepared` contains only `entryFile` and `htmlFile`, and `runtime.aliases` contains selected `{ packageName, sourceDir }` descriptors

#### Scenario: Different envs select different components
- **WHEN** the command prepares separate vendor tasks for two envs
- **THEN** each task's alias descriptors contain only the components selected for that env rather than the complete workspace component catalog

#### Scenario: Generated source references runtime modules
- **WHEN** the generated entry references a docs, demo, mounter, or `docsTemplate` module
- **THEN** it uses the command-resolved module path encoded as a safe JavaScript string literal

### Requirement: Preparation failures are isolated and visible
If preparation fails for one env, the command SHALL mark that env as failed with a useful reason and SHALL continue preparing other independent envs. In eager mode it SHALL activate other successfully prepared envs; in lazy mode it SHALL retain their idle logical tasks until access. If no env can be prepared, the command SHALL close the proxy and terminate without leaking resources.

#### Scenario: One of multiple envs cannot be prepared eagerly
- **WHEN** two envs are selected, preparation fails for one, and lazy execution is disabled
- **THEN** the valid env's vendor starts and the proxy manifest reports the failed env and reason

#### Scenario: One of multiple envs cannot be prepared lazily
- **WHEN** two envs are selected, preparation fails for one, and lazy execution is enabled
- **THEN** the valid env remains available as an idle logical task and the proxy manifest reports the failed env and reason

#### Scenario: Every env fails preparation
- **WHEN** all selected preview envs fail preparation
- **THEN** no vendor starts, the proxy is closed, and the command reports the failures

## MODIFIED Requirements

### Requirement: Local env components use configured compilation
A registered `kind: "env"` component SHALL be compiled through the `services.compile` vendor configured by that component's own effective environment, using the same planner, dispatcher, vendor context, and watch flag as every other component. Core SHALL NOT select a compiler from component kind. The maintained environment compiler SHALL be an ordinary vendor in `demo-vendors` and SHALL emit the generated package's default entry as flattened `dist/index.json` together with supported compiled static modules.

#### Scenario: JSON-only env component is compiled
- **WHEN** a local env component's assigned environment configures the maintained environment compiler and the component contains `index.json`
- **THEN** normal compiler dispatch emits flattened `dist/index.json` and the generated package default export resolves to it

#### Scenario: Env owns a TypeScript vendor config
- **WHEN** a local env component contains `webpack-react.ts` beside `index.json`
- **THEN** the maintained environment compiler emits `dist/webpack-react.js` beside `dist/index.json`

#### Scenario: Env assignment configures a different compiler
- **WHEN** a local env component's effective environment configures another valid compile vendor
- **THEN** core invokes that configured vendor without substituting the maintained environment compiler

#### Scenario: Env component runs in watch mode
- **WHEN** compile watch creates a task for an env component using the maintained environment compiler
- **THEN** that vendor owns the watcher and rebuilds its generated package as relevant source files change

### Requirement: Env packages export JSON definitions
An env package's default `"."` export SHALL resolve to a JSON file containing either a source `EnvDefinition` for an external package or a versioned `CompiledEnvDefinition` for a generated local package. The loader SHALL read and parse JSON without ESM JSON import attributes, strictly validate the detected format once per canonical entry and requested version, and reuse the loaded runtime for all matching component references. A generated local package SHALL be rejected if it exports an uncompiled source definition.

#### Scenario: Compiled JSON definition is shared by multiple components
- **WHEN** three components reference the same validated compiled env package and version
- **THEN** the loader reads, parses, validates, and constructs its flattened runtime once and all three components reuse it

#### Scenario: External source definition is loaded
- **WHEN** an installed external env package exports a valid source definition with `extends`
- **THEN** the loader retains source-package inheritance compatibility and constructs the same effective runtime contract

#### Scenario: Generated local env exports source JSON
- **WHEN** a registered generated env package default entry lacks the compiled format marker
- **THEN** loading fails and instructs the caller to compile the local env through its configured compiler

#### Scenario: Default export is not JSON
- **WHEN** the default package entry resolves to a JavaScript module or another unsupported entry type
- **THEN** workspace loading fails with the env package, resolved entry, and required JSON-entry contract

#### Scenario: Exported JSON is malformed
- **WHEN** the resolved env entry contains invalid JSON
- **THEN** loading fails in the parse phase with the env package, entry path, affected components, and original parse cause

#### Scenario: Default package export is missing
- **WHEN** package resolution cannot resolve the env package's default `"."` export
- **THEN** loading fails before definition validation with the requested package and attempted dependency context

### Requirement: Env definitions support package-based inheritance
A source `EnvDefinition` MAY declare one `extends` field containing the full npm package name of its parent env. Source loading and environment compilation SHALL require that parent in the child env package's normal dependencies, use the declared dependency version as the parent reference, resolve and validate recursively from the child package's dependency context, and apply shallow service/config merges from ancestor to child. The maintained environment compiler SHALL serialize the final flattened definition, inheritance path, and service origins so compiled runtime loading SHALL NOT resolve `extends` again. Aliases, relative paths, multiple parents, dev-only parent declarations, and workspace-supplied parent mappings SHALL NOT be accepted.

#### Scenario: Child compiler flattens an omitted service
- **WHEN** a child env extends a declared parent, the parent defines test and compile, and the child defines only preview
- **THEN** compiled `dist/index.json` contains the parent's test and compile plus the child's preview without a runtime `extends` field

#### Scenario: Child replaces a parent service
- **WHEN** a child and its parent both define test
- **THEN** the compiled child's complete test service replaces the parent's vendor and config rather than deep-merging them

#### Scenario: Parent and child define top-level config
- **WHEN** parent and child top-level config objects contain distinct keys and one shared key
- **THEN** the flattened config contains both distinct keys and the child's value for the shared key

#### Scenario: Inheritance chain is recursive
- **WHEN** an env extends a parent that extends a grandparent and all dependencies resolve
- **THEN** compilation resolves the grandparent first, applies each shallow merge in order, retains the selected child's package name, and records the complete inheritance path

#### Scenario: Parent is not a runtime dependency
- **WHEN** `extends` names a package absent from the child env package's normal dependencies or present only in its development dependencies
- **THEN** source loading or compilation fails with the child package, parent package, and required runtime dependency declaration

#### Scenario: Inheritance chain is circular
- **WHEN** resolving `extends` reaches a canonical env package entry already present in the active inheritance chain
- **THEN** source loading or compilation fails and reports the complete package chain without emitting a compiled artifact

### Requirement: Loaded env definitions have package identity
Parsed source or compiled JSON SHALL have a `name` exactly equal to the resolved npm package name, JSON-safe optional top-level `config`, and services satisfying the env service contract. A compiled definition SHALL additionally have a supported format version, flattened inheritance metadata, and valid service-origin metadata. The loader SHALL reject identity mismatches rather than normalizing or aliasing them. Its loaded runtime SHALL retain the selected package name, configured requested version, and resolved installed manifest version as distinct fields, and JSON-safe service boundaries SHALL project those fields without reducing them to a package-name-only identity.

#### Scenario: Compiled definition has matching identity and format
- **WHEN** `@acme/env.react` exports an otherwise valid compiled definition named `@acme/env.react` with a supported format version
- **THEN** it is accepted while requested and installed versions remain distinct on the loaded runtime

#### Scenario: Compiled definition uses an unsupported version
- **WHEN** a generated env artifact declares an unknown format version
- **THEN** validation fails with the artifact entry and supported version information

#### Scenario: External env range resolves to an installed version
- **WHEN** a component requests `@acme/env.react@^1.2.0` and package resolution selects manifest version `1.4.3`
- **THEN** the selected env identity contains package name `@acme/env.react`, requested version `^1.2.0`, and installed version `1.4.3` separately

#### Scenario: Local env uses workspace protocol
- **WHEN** a component requests `@acme/env.react@workspace:*` and the registered generated env package is loaded
- **THEN** the selected env identity retains `workspace:*` separately from the generated package's installed manifest version

#### Scenario: JSON definition contains an alias
- **WHEN** `@acme/env.react` exports a definition named `react`
- **THEN** workspace loading fails and reports the expected and actual names

#### Scenario: Definition contains forbidden service fields
- **WHEN** the JSON definition contains execution state or generic target configuration outside the env service contract
- **THEN** validation fails before a vendor task is created

### Requirement: Env-owned specifiers retain their declaring-entry origin
The loaded env runtime SHALL retain the declaring package name, package root, entry URL, and entry directory for every effective service separately from its JSON-safe definition. For source definitions, inherited services SHALL retain their ancestor's live package origin. For compiled definitions, each service SHALL identify a dependency path from the selected env package to its declaring package; the loader SHALL follow each dependency hop from the current package context and reconstruct the same origin. Relative paths SHALL remain inside the declaring package root, and package/subpath specifiers SHALL resolve through package exports from the declaring context with the documented workspace fallback.

#### Scenario: Compiled local service is declared by the child
- **WHEN** a compiled env's service origin has an empty dependency path and config names `./webpack-react.js`
- **THEN** the loader resolves that module from the compiled child entry directory and enforces the child package root

#### Scenario: Compiled child inherits a parent service
- **WHEN** a compiled child records a parent service origin with a dependency path to the parent package
- **THEN** the loader follows that path, resolves the service from the parent's entry directory, and retains the child identity for grouping

#### Scenario: Origin dependency path is invalid
- **WHEN** a compiled service origin references a package hop not declared or resolvable from the preceding package
- **THEN** loading fails with the selected env, service, dependency path, and failing hop

#### Scenario: Env declares an exported package subpath
- **WHEN** an effective env service names `demo-config/previewers/react-mounter`
- **THEN** resolution honors that package's exports map from the reconstructed declaring dependency context

#### Scenario: Relative config escapes its package
- **WHEN** a relative module specifier resolves outside the declaring env package root
- **THEN** preparation fails with the env, service field, original specifier, and rejected path

#### Scenario: Vendor exists only in the workspace
- **WHEN** an env's vendor cannot be resolved from the declaring package but is resolvable from the documented workspace context
- **THEN** vendor loading uses the workspace package as the explicit fallback

## REMOVED Requirements

### Requirement: Local env components use fixed materialization
**Reason**: Environment components now use the same configured compiler-service path as every component; core no longer owns a non-configurable materializer.
**Migration**: Assign each env component an environment whose `services.compile` points to the desired compiler vendor. Use the maintained `demo-vendors/compilers/env` vendor for flattened environment artifacts.

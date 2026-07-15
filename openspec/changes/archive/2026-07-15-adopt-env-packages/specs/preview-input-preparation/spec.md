## MODIFIED Requirements

### Requirement: Existing preview service modules are resolved centrally
The command SHALL resolve the existing `configFile`, optional `mounter`, and optional `docsTemplate` specifiers from the package that declared the effective preview service and SHALL validate their existence before vendor startup. For an inherited preview service this SHALL be the ancestor env package, not the selected child env. Relative specifiers SHALL resolve from the directory containing the declaring env's resolved JSON entry and SHALL remain inside that package root, while package and package-subpath specifiers SHALL resolve through Node package exports from that package's dependency context with the workspace as the documented fallback. `configFile` SHALL continue to identify the env's Vite or Webpack dev-server/toolchain config. A mounter SHALL be required only when the selected env manifest contains at least one demo.

#### Scenario: Docs-only env omits a mounter
- **WHEN** an env's selected components contain docs but no demos and `mounter` is absent
- **THEN** preparation succeeds and the generated entry can render docs through the configured or built-in `DocsTemplate`

#### Scenario: Demo env omits a mounter
- **WHEN** an env's selected components contain at least one demo and `mounter` is absent
- **THEN** preparation fails with an error that identifies the env package and missing field and the vendor task is not started

#### Scenario: Generated in-package preview config is declared
- **WHEN** a React env entry at `dist/index.json` declares `configFile: "./webpack-react.js"` after fixed env materialization generated that file
- **THEN** the command resolves `dist/webpack-react.js` from the React env entry directory before starting the preview vendor

#### Scenario: Preview service is inherited
- **WHEN** a selected child env inherits its preview service from a parent env package
- **THEN** the command resolves the service modules and vendor from the parent entry and dependency context while proxying and reporting the preview under the selected child's structured package name, requested version, and installed version identity

#### Scenario: Exported preview config subpath is declared
- **WHEN** a preview module uses a package subpath such as `demo-config/previewers/react-mounter`
- **THEN** the command resolves that subpath according to Node package exports from the effective service's declaring package context

#### Scenario: Configured service module cannot be resolved
- **WHEN** `configFile`, `mounter`, or `docsTemplate` cannot be resolved from the declaring env entry, package dependency context, or documented workspace fallback
- **THEN** preparation fails before vendor startup with the selected env, declaring env, config field, module specifier, and attempted origins in the error

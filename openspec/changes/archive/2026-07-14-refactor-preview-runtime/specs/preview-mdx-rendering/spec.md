## ADDED Requirements

### Requirement: demo-utils exposes reusable build-time MDX options
The `demo-utils` package SHALL export shared MDX compiler options, or a factory for deriving them, as ordinary JavaScript for dev-server config files to import. The export MAY contain remark or rehype plugin functions and SHALL NOT be required to satisfy the JSON vendor runtime contract.

#### Scenario: Shared options contain plugin functions
- **WHEN** `demo-utils` defines remark or rehype plugins as function values
- **THEN** a Vite or Webpack config can import and pass those values directly to its native MDX integration

#### Scenario: An env needs a local variation
- **WHEN** a dev-server config needs to append or override an MDX option
- **THEN** it can compose a local options object from the shared export without changing preview runtime data

### Requirement: Each dev-server config owns its native MDX integration
Supported Vite and Webpack preview configs SHALL import the shared `demo-utils` options and apply them through the toolchain's native MDX plugin or loader. Both `.docs.md` and `.docs.mdx` SHALL compile into browser-loadable modules; a vendor SHALL NOT inject an MDX adapter or reconstruct plugin descriptors.

#### Scenario: Vite config enables MDX
- **WHEN** the Vite preview dev server loads its config
- **THEN** the config applies the shared options through `@mdx-js/rollup` or the selected native Vite MDX integration

#### Scenario: Webpack config enables MDX
- **WHEN** the Webpack preview dev server loads its config
- **THEN** the config applies the shared options through `@mdx-js/loader` or the selected native Webpack MDX integration

#### Scenario: Vendor starts with docs
- **WHEN** a prepared env contains docs
- **THEN** the vendor loads the resolved `configFile` and does not receive, serialize, normalize, or inject MDX options itself

### Requirement: MDX compilation and docs rendering remain separate
MDX options SHALL control how a docs source becomes a JavaScript module before browser execution. `DocsTemplate` SHALL control how that compiled module is displayed at runtime and SHALL receive only `{ docs }`; neither responsibility SHALL absorb component-overview or demo-mounting behavior.

#### Scenario: Docs module compiles successfully
- **WHEN** the active docs route lazy-loads a module produced by the configured MDX integration
- **THEN** the browser runtime passes that module as the `docs` property to `DocsTemplate`

#### Scenario: DocsTemplate is customized
- **WHEN** an env config supplies a custom `docsTemplate`
- **THEN** the custom template can change runtime document presentation without changing the shared MDX compiler options

### Requirement: Supported configs provide equivalent shared MDX behavior
The maintained Vite and Webpack configs SHALL consume the same shared MDX utility so equivalent docs sources expose equivalent content and configured transformations to `DocsTemplate`. Toolchain-specific adapter syntax MAY differ.

#### Scenario: Same Markdown docs run under different toolchains
- **WHEN** equivalent `.docs.md` sources are served through the maintained Vite and Webpack configs
- **THEN** their compiled modules provide equivalent rendered content and shared plugin transformations

#### Scenario: MDX includes JSX
- **WHEN** an equivalent `.docs.mdx` source uses valid JSX and imports
- **THEN** both maintained configs compile it into a module that the same `DocsTemplate` contract can render

### Requirement: MDX configuration failures surface explicitly
A failure while loading the dev-server config, an MDX integration, or one of its configured plugins SHALL fail the affected env with the original cause and useful config context. The system MUST NOT serve raw MDX or silently fall back to a reduced vendor-owned Markdown renderer.

#### Scenario: Configured plugin throws
- **WHEN** a plugin imported by the shared options or local config throws during compilation
- **THEN** the affected dev-server task reports the build failure through the existing vendor error path

#### Scenario: MDX integration is missing
- **WHEN** a maintained config cannot load its declared MDX plugin or loader
- **THEN** startup fails instead of serving docs without the configured compilation behavior

### Requirement: MDX parity is verified across maintained configs
The test suite SHALL run a shared docs fixture containing frontmatter, Markdown, JSX, and at least one shared remark or rehype transformation through the maintained Vite and Webpack configs.

#### Scenario: MDX parity suite runs
- **WHEN** repository tests compile and render the shared fixture through both configs
- **THEN** both results contain the expected content, frontmatter export, JSX output, plugin transformation, and `DocsTemplate` rendering

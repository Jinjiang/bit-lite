# bit-lite-demo-workspace

This package is a complete Bit Lite workspace fixture. It is designed for:

- trying the CLI by hand;
- exercising environment inheritance;
- testing local component dependencies;
- checking Node.js, React, and Vue service integrations;
- running CLI end-to-end tests.

The workspace manifest is [`bit-lite.json`](./bit-lite.json).

## Components at a glance

### `envs/react`

- Package: `@my-scope/env.react`
- Kind: environment component
- Build env: `demo-env-env`
- Extends: `demo-env-node`
- Overrides the test service with Jest
- Overrides the preview service with Webpack and a React mounter

### `lib/math`

- Package: `@my-scope/lib.math`
- Env: `demo-env-node`
- Includes TypeScript source, unit tests, a spec, Markdown docs, and a composition

### `ui/button`

- Package: `@my-scope/ui.button`
- Env: local `@my-scope/env.react`
- Depends on `@my-scope/lib.math` through `workspace:*`
- Includes React tests, MDX docs, a composition, and an interaction spec

### `ui/legacy-badge`

- Package: `@my-scope/ui.legacy-badge`
- Env: local `@my-scope/env.react`
- Provides a second React docs/composition target

### `vue/card`

- Package: `@my-scope/vue.card`
- Env: `demo-env-vue`
- Includes a Vue SFC, tests, a spec, docs, and a composition

## Prepare the workspace

Run all commands from the repository root:

```bash
pnpm install
pnpm build

node packages/bit-lite/dist/bin.js install \
  --workspace packages/demo-workspace \
  --compile
```

The install command creates the isolated dependency projects required by the component sources and compiles the local React env before other services load it.

## Useful sessions

Run the complete development experience:

```bash
node packages/bit-lite/dist/bin.js start \
  --workspace packages/demo-workspace
```

Run one environment's tests:

```bash
node packages/bit-lite/dist/bin.js test \
  --workspace packages/demo-workspace \
  --filter 'ui/*'
```

Preview only the Vue component:

```bash
node packages/bit-lite/dist/bin.js preview \
  --workspace packages/demo-workspace \
  --filter vue/card \
  --lazy
```

Watch the framework-neutral component compiler:

```bash
node packages/bit-lite/dist/bin.js compile \
  --workspace packages/demo-workspace \
  --filter lib/math \
  --watch
```

## Component file conventions demonstrated here

| Pattern | Meaning |
| --- | --- |
| `index.*` | Component entry |
| `.comp.json` | Inspectable, materialized component state: dependency metadata and optional kind; fixture-provided today, intended to be generated |
| `*.test.*` | Unit test |
| `*.spec.*` | Additional test/spec input |
| `*.docs.md`, `*.docs.mdx` | Preview documentation |
| `*.demo.*` | Preview composition |

## Generated state

Bit Lite writes development state inside the fixture:

- `.bit-lite/deps` contains generated pnpm projects for isolated dependency installation.
- `node_modules/@my-scope` contains generated component package links.
- Generated component packages contain their `dist` output.
- Source component directories receive `node_modules` links to the appropriate isolated dependency project.

Do not edit these paths by hand.

## Reset the fixture

```bash
pnpm --filter bit-lite-demo-workspace clean
```

The clean script removes `.bit-lite`, generated package entries, selected installed dependencies, and component-level dependency links. Component source files are preserved.

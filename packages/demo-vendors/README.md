# demo-vendors

`demo-vendors` contains executable reference integrations for Bit Lite services.

These modules are used by the demo env packages and by integration tests throughout the monorepo. They favor small, inspectable implementations over production-level configuration coverage.

## Test vendors

### `demo-vendors/testers/jest`

Finds test files for the selected components, loads a Jest configuration module, and runs Jest in one-shot or watch mode.

### `demo-vendors/testers/vitest`

Builds a Vitest file set for the selected components and runs Vitest in one-shot or watch mode.

Both vendors publish Bit Lite's common test result shape, including aggregate statistics and per-component results.

## Preview vendors

### `demo-vendors/previewers/vite`

Starts a Vite development server using the generated entry and HTML supplied by `bit-lite-preview`.

### `demo-vendors/previewers/webpack`

Starts Webpack compiler, dev middleware, and hot middleware for the same prepared preview input.

Both implementations report their server origin to the preview proxy and provide a cleanup callback.

## Compiler vendors

### `demo-vendors/compilers/typescript`

- transpiles TypeScript and JavaScript source;
- emits lightweight declaration files;
- copies Vue, style, JSON, and declaration assets;
- excludes tests, specs, generated output, and preview-only files;
- supports watch mode.

### `demo-vendors/compilers/env`

- reads an env component's JSON entry;
- resolves and validates its parent definition;
- writes the flattened definition to `dist/index.json`;
- supports watch mode.

## Protocol fixtures

The following exports exist primarily for runner and orchestration tests:

```text
demo-vendors/foo-x
demo-vendors/bar-x
demo-vendors/bar-y
demo-vendors/bar-z
demo-vendors/baz-x
demo-vendors/test-x
demo-vendors/test-y
demo-vendors/mixed-results
```

They exercise message ordering, different result shapes, inline and worker execution, failure propagation, and shutdown behavior. The package root exports these fixtures as `samples`.

## Referencing a vendor

An env stores the exact export subpath:

```json
{
  "services": {
    "compile": {
      "vendor": "demo-vendors/compilers/typescript",
      "config": {
        "target": "ES2022"
      }
    }
  }
}
```

## Package development

```bash
pnpm --filter demo-vendors build
pnpm --filter demo-vendors typecheck
pnpm --filter demo-vendors test
```

Changes to runner-facing behavior should also be checked against:

```bash
pnpm --filter bit-lite-vendors test
pnpm --filter bit-lite test
```

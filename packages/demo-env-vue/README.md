# demo-env-vue

`demo-env-vue` is the environment for Vue components.

## Package entry

The package exports its environment definition directly from [`index.json`](./index.json).

| Field | Value |
| --- | --- |
| Environment name | `demo-env-vue` |
| Extends | None |
| Purpose | Test, preview, and compile Vue components |

## Services

| Service | Vendor | Configuration |
| --- | --- | --- |
| test | `demo-vendors/testers/vitest` | `demo-config/testers/vitest/vue` |
| preview | `demo-vendors/previewers/vite` | Vue Vite config, Vue mounter, and shared docs template |
| compile | `demo-vendors/compilers/typescript` | ES2022 target, preserved JSX, and Vue file support |

## Demo workspace usage

| Component | Package | Usage |
| --- | --- | --- |
| `vue/card` | `@my-scope/vue.card` | Selects this env directly |

The component exercises Vue SFC compilation, Vitest, Markdown docs, and a Vue composition.

## Validate changes

```bash
pnpm build

node packages/bit-lite/dist/bin.js install \
  --workspace packages/demo-workspace \
  --compile

node packages/bit-lite/dist/bin.js start \
  --workspace packages/demo-workspace \
  --filter vue/card
```

## Development notes

This is a JSON-only package with no build, type-check, or test scripts. Edit `index.json` directly and validate it through [`demo-workspace`](../demo-workspace/README.md).

Its vendors and configuration modules are documented in [`demo-vendors`](../demo-vendors/README.md) and [`demo-config`](../demo-config/README.md).

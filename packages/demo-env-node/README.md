# demo-env-node

`demo-env-node` is the baseline environment for framework-neutral TypeScript components.

## Package entry

The package exports its environment definition directly from [`index.json`](./index.json).

| Field | Value |
| --- | --- |
| Environment name | `demo-env-node` |
| Extends | None |
| Purpose | Test, preview, and compile framework-neutral TypeScript components |

## Services

| Service | Vendor | Configuration |
| --- | --- | --- |
| test | `demo-vendors/testers/vitest` | `demo-config/testers/vitest/node` |
| preview | `demo-vendors/previewers/vite` | Static Vite config, static mounter, and shared docs template |
| compile | `demo-vendors/compilers/typescript` | ES2022 target with `react-jsx` |

## Demo workspace usage

| Component | Package | Usage |
| --- | --- | --- |
| `lib/math` | `@my-scope/lib.math` | Selects this env directly |
| `envs/react` | `@my-scope/env.react` | Extends this env and overrides its test and preview services |

The `lib/math` component exercises TypeScript compilation, Vitest, Markdown docs, and a framework-neutral composition.

## Validate changes

```bash
pnpm build

node packages/bit-lite/dist/bin.js install \
  --workspace packages/demo-workspace \
  --compile

node packages/bit-lite/dist/bin.js start \
  --workspace packages/demo-workspace \
  --filter lib/math
```

## Development notes

This is a JSON-only package with no build, type-check, or test scripts. Edit `index.json` directly and validate it through [`demo-workspace`](../demo-workspace/README.md).

Its vendors and configuration modules are documented in [`demo-vendors`](../demo-vendors/README.md) and [`demo-config`](../demo-config/README.md).

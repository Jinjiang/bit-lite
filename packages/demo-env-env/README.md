# demo-env-env

`demo-env-env` is the bootstrap environment used to compile environment components.

## Package entry

The package exports its environment definition directly from [`index.json`](./index.json).

| Field | Value |
| --- | --- |
| Environment name | `demo-env-env` |
| Extends | None |
| Purpose | Flatten and compile another environment definition |

## Services

| Service | Vendor | Configuration |
| --- | --- | --- |
| test | Not configured | — |
| preview | Not configured | — |
| compile | `demo-vendors/compilers/env` | Empty configuration |

## Demo workspace usage

| Component | Package | Usage |
| --- | --- | --- |
| `envs/react` | `@my-scope/env.react` | Uses this bootstrap env to produce its compiled `dist/index.json` |

The env compiler resolves the component's `extends` chain and records the origin of each inherited or overridden service.

## Validate changes

```bash
pnpm build

node packages/bit-lite/dist/bin.js install \
  --workspace packages/demo-workspace \
  --compile

node packages/bit-lite/dist/bin.js compile \
  --workspace packages/demo-workspace \
  --filter envs/react
```

## Development notes

This is a JSON-only package with no build, type-check, or test scripts. Edit `index.json` directly and validate it through [`demo-workspace`](../demo-workspace/README.md).

The selected compiler is implemented in [`demo-vendors`](../demo-vendors/README.md).

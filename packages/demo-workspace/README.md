# demo-workspace

This fixture demonstrates three env identities:

- `demo-env-node@0.0.0` and `demo-env-vue@0.0.0` are external env packages from
  each selecting component's development dependency context.
- `@my-scope/env.react@workspace:*` is a registered `kind: "env"` component in
  `components/envs/react`.
- The React JSON env extends `demo-env-node` as a normal runtime dependency,
  replaces test/preview services, inherits compile, and references its fixed-
  compiled `./webpack-react.js` beside the generated JSON entry.

Run the reproducible flow from the repository root:

```sh
node packages/bit-lite/dist/bin.js install --workspace packages/demo-workspace --compile
node packages/bit-lite/dist/bin.js test --workspace packages/demo-workspace
node packages/bit-lite/dist/bin.js preview --workspace packages/demo-workspace
```

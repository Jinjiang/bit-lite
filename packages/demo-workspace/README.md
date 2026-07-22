# demo-workspace

This fixture demonstrates three env identities:

- `demo-env-node@0.0.0` and `demo-env-vue@0.0.0` are external env packages from
  each selecting component's development dependency context.
- `@my-scope/env.react@workspace:*` is a registered `kind: "env"` component in
  `components/envs/react`.
- That env component selects external `demo-env-env`, whose configured compile
  vendor is `demo-vendors/compilers/env`; core performs no env-kind dispatch.
- The React JSON env extends `demo-env-node` as a normal runtime dependency,
  replaces test/preview services, inherits compile, and references its compiled
  `./webpack-react.js` beside flattened versioned `dist/index.json`.

The inherited compile invocation therefore selects `@my-scope/env.react` in
`context.env` while its `context.service.source` points to `demo-env-node`, the
package that declared the compiler. Test and preview vendors receive the same
version-1 context plus canonical components and command-prepared config/runtime,
and return produced service data without echoing that context.

Run the reproducible flow from the repository root:

```sh
node packages/bit-lite/dist/bin.js install --workspace packages/demo-workspace --compile
node packages/bit-lite/dist/bin.js compile --workspace packages/demo-workspace --watch
node packages/bit-lite/dist/bin.js test --workspace packages/demo-workspace
node packages/bit-lite/dist/bin.js preview --workspace packages/demo-workspace
```

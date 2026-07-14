# bit-lite-preview

Shared preview contracts and browser runtime.

Exports:

- `bit-lite-preview`: JSON contracts and hash route helpers.
- `bit-lite-preview/node`: validation for the minimal prepared vendor runtime.
- `bit-lite-preview/browser`: `startPreview()`, default overview/docs renderers,
  mounter and renderer types.

`startPreview({ components, mounter?, docsTemplate?, renderOverview? })` uses one
document and one entry to render overview, docs, or a named demo from
`location.hash`. All renderer inputs are optional. Docs and demos stay lazy
because their records own literal `load: () => import(...)` functions.

```sh
pnpm --filter bit-lite-preview test
pnpm --filter bit-lite-preview typecheck
pnpm --filter bit-lite-preview build
```

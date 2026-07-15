# bit-lite-preview

Shared preview contracts and browser runtime.

Exports:

- `bit-lite-preview`: JSON contracts and hash route helpers.
- `bit-lite-preview/node`: prepared-entry discovery/generation, preview proxy,
  HTML assets, and validation for the minimal prepared vendor runtime.
- `bit-lite-preview/browser`: `startPreview()`, default overview/docs renderers,
  mounter and renderer types.

`startPreview({ components, mounter?, docsTemplate?, renderOverview? })` uses one
document and one entry to render overview, docs, or a named demo from
`location.hash`. All renderer inputs are optional. Docs and demos stay lazy
because their records own literal `load: () => import(...)` functions.

Preparation treats every runtime value export from every `*.demo.*` file as a
separate demo. A browser descriptor contains the composite
`<file-id>/<export-name>` ID, original `exportName`, derived `name`, encoded hash
route, and a loader shaped like:

```ts
load: () => import("./primary.demo.ts")
  .then((module) => module["MySecondDemo"])
```

The runtime passes that selected value directly to the env mounter. Named
exports are preferred; `default` is supported as the discouraged `Default`
demo. Type-only exports are ignored, helpers must remain unexported, and bare
`export *` is rejected. Existing exports retain HMR; catalog changes require a
preview restart.

Prepared env state, skipped env state, and proxy manifest entries carry
`env: { packageName, requestedVersion, installedVersion }`. Internal proxy keys
derive from the package reference, while public `/env/<package-name>/` routes
remain unchanged for this single-version phase.

```sh
pnpm --filter bit-lite-preview test
pnpm --filter bit-lite-preview typecheck
pnpm --filter bit-lite-preview build
```

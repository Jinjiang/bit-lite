# demo-config

Maintained demo workspace configs for tests and examples.

- Vite configs apply `demo-utils` options through `@mdx-js/rollup`.
- Webpack applies the same options through `@mdx-js/loader`.
- framework-specific mounters remain runtime inputs.
- `previewers/docs-template` demonstrates the optional docs-only
  `PreviewDocsTemplateProps` contract.

```json
{
  "configFile": "demo-config/previewers/vite-static",
  "mounter": "demo-config/previewers/static-mounter",
  "docsTemplate": "demo-config/previewers/docs-template"
}
```

```sh
pnpm --filter demo-config test
pnpm --filter demo-config typecheck
pnpm --filter demo-config build
```

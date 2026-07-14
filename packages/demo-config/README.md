# demo-config

Maintained demo workspace configs for tests and examples.

- Vite configs apply `demo-utils` options through `@mdx-js/rollup`.
- Webpack applies the same options through `@mdx-js/loader`.
- framework-specific mounters remain runtime inputs.
- `previewers/docs-template` demonstrates the optional docs-only
  `PreviewDocsTemplateProps` contract.

Demo mounters receive the value of the selected export directly. Maintained
examples prefer named exports such as `Primary` or `MySecondDemo`; one Vue
fixture retains `default` only to verify compatibility. A file may define
multiple demos, but non-demo helpers should not be exported because every
runtime export becomes an independently routed demo.

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

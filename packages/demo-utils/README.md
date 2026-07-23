# demo-utils

`demo-utils` is a small shared module for the demo's MDX toolchain.

## Exports

`mdxOptions` contains the default MDX compile options. It enables YAML frontmatter and exposes parsed frontmatter as a module export.

`createMdxOptions(overrides)` creates a new options object:

```ts
import { createMdxOptions } from "demo-utils";

const options = createMdxOptions({
  development: true,
  rehypePlugins: [customPlugin],
});
```

Override fields replace their defaults, with two exceptions:

- `remarkPlugins` are appended after the built-in frontmatter plugins.
- `rehypePlugins` are appended to the default list.

The `DemoMdxOptions` type is an alias for `@mdx-js/mdx`'s `CompileOptions`.

## Package development

```bash
pnpm --filter demo-utils build
pnpm --filter demo-utils typecheck
pnpm --filter demo-utils test
```

The main consumer is [`demo-config`](../demo-config/README.md).
